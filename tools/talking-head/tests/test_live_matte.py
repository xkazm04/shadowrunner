"""Live mattes (th/live/matte): the guided upsample and the temporal smoother on CPU, the stride path,
the registry and licence rows, the bench's flicker figure, and every kind on CUDA (skipped without
CUDA, the weights, or a mediapipe that still has the legacy selfie solution)."""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from th.live.matte import get_matte, kinds, weights  # noqa: E402
from th.live.matte.base import BaseMatte  # noqa: E402
from th.live.matte.bench import flicker, parse_config  # noqa: E402
from th.live.matte.refine import TemporalSmoother, box, guided_upsample  # noqa: E402

HAS_CUDA = torch.cuda.is_available()


def _step_guide(n: int = 2, size: int = 64, edge: int = 37) -> torch.Tensor:
    """N,3,H,W: bright left of column `edge`, dark right of it (a hard colour edge)."""
    g = torch.full((n, 3, size, size), 0.1)
    g[..., :edge] = 0.9
    return g


def test_box_keeps_constants_at_the_border():
    x = torch.full((1, 1, 8, 8), 0.7)
    assert torch.allclose(box(x, 3), x)


def test_guided_upsample_snaps_the_edge_to_the_colour_edge():
    guide = _step_guide()
    truth = (guide[:, :1] > 0.5).float()
    low = torch.nn.functional.interpolate(truth, size=(16, 16), mode="area")
    bilinear = torch.nn.functional.interpolate(low, size=(64, 64), mode="bilinear", align_corners=False)
    refined = guided_upsample(guide, low, r=2, eps=1e-4)
    assert refined.shape == (2, 1, 64, 64)
    assert 0 <= refined.min() and refined.max() <= 1
    assert (refined - truth).abs().mean() < 0.5 * (bilinear - truth).abs().mean()


def test_smoother_damps_flicker_where_the_picture_is_still():
    s = TemporalSmoother(k_min=0.25)
    rgb = torch.full((4, 3, 8, 8), 0.5)
    alpha = torch.tensor([1.0, 0.0, 1.0, 0.0]).view(4, 1, 1, 1).expand(4, 1, 8, 8).contiguous()
    out = s(rgb, alpha)
    steps = (out[1:] - out[:-1]).abs().mean()
    assert steps < 0.3  # raw alpha jumps by 1.0 each frame


def test_smoother_follows_motion_at_once_and_carries_state():
    s = TemporalSmoother(k_min=0.25, thr=0.05)
    rgb = torch.zeros((2, 3, 8, 8))
    rgb[1] = 1.0  # the picture changed completely
    alpha = torch.stack([torch.zeros(1, 8, 8), torch.ones(1, 8, 8)])
    out = s(rgb, alpha)
    assert torch.allclose(out[1], torch.ones(1, 8, 8))
    still = s(rgb[1:].clone(), torch.zeros(1, 1, 8, 8))  # next chunk: still picture, alpha drops
    assert torch.allclose(still, torch.full((1, 1, 8, 8), 0.75))
    s.reset()
    assert s.prev_alpha is None


class _Ramp(BaseMatte):
    """A fake network: alpha = the frame index / 100 everywhere, counting how many frames it saw."""

    kind = "ramp"

    def _load(self) -> None:
        self.seen = 0

    def _infer(self, rgb, frames):
        self.seen += rgb.shape[0]
        return frames[:, :1, :1, 0].float().view(-1, 1, 1, 1).expand(-1, 1, 8, 8) / 100


def test_stride_interpolates_between_key_frames():
    m = _Ramp(res=8, guide_r=0, smooth=1.0, stride=4, device="cpu")
    frames = torch.arange(10, dtype=torch.uint8).view(10, 1, 1, 1).expand(10, 16, 16, 3).contiguous()
    alpha = m.alpha_float(frames)
    assert m.seen == 4  # frames 0, 4, 8 and the last (9)
    assert alpha.shape == (10, 1, 16, 16)
    assert torch.allclose(alpha[:, 0, 0, 0], torch.arange(10) / 100, atol=1e-6)
    out = m(frames)
    assert out.dtype == torch.uint8 and out.shape == (10, 16, 16)


def test_registry():
    assert kinds.DEFAULT in kinds.KINDS
    assert set(kinds.KINDS) >= {"mediapipe", "birefnet-lite", "birefnet-lite-matting"}
    with pytest.raises(ValueError):
        get_matte("bogus")
    m = get_matte("birefnet-lite-matting")  # building is lazy: no weights are loaded here
    assert m.kind == "birefnet-lite-matting" and not m.loaded and m.stride == 2 and m.res == 384
    fast = get_matte("birefnet-lite-matting-fast")
    assert fast.kind == "birefnet-lite-matting-fast" and fast.weights == "birefnet-lite-matting"


def test_licence_rows_merge_by_name(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    weights.record(weights.birefnet_row("birefnet-lite"))
    weights.record(weights.birefnet_row("birefnet-lite"))
    weights.record(weights.MEDIAPIPE_ROW)
    rows = weights.read_rows()
    assert [r["name"] for r in rows] == ["ZhengPeng7/BiRefNet_lite", weights.MEDIAPIPE_ROW["name"]]
    assert all(r["licence"].startswith(("MIT", "Apache-2.0")) for r in rows)


def test_bench_parse_and_flicker():
    assert parse_config("birefnet-lite:res=384,guide=0,smooth=0.5,stride=2") == (
        "birefnet-lite", {"res": 384, "guide_r": 0, "smooth": 0.5, "stride": 2})
    frames = np.zeros((3, 32, 32, 3), np.uint8)
    alpha = np.zeros((3, 32, 32), np.uint8)
    alpha[:, :, :16] = 255
    alpha[1, :, 15] = 128  # the edge flickers while the picture stands still
    f = flicker(alpha, frames)
    assert f["flicker"] > 0 and f["staticFlicker"] == f["flicker"] and f["bandPx"] > 0


def _available(kind: str) -> bool:
    if kind == "mediapipe":
        try:
            import mediapipe as mp

            return hasattr(mp, "solutions") and hasattr(mp.solutions, "selfie_segmentation")
        except Exception:
            return False
    return weights._ready(weights.birefnet_path(get_matte(kind).weights))


@pytest.mark.skipif(not HAS_CUDA, reason="needs CUDA")
@pytest.mark.parametrize("kind", list(kinds.KINDS))
def test_kind_on_cuda(kind):
    if not _available(kind):
        pytest.skip(f"{kind}: weights or mediapipe's legacy selfie solution missing")
    m = get_matte(kind)
    frames = torch.zeros((5, 512, 512, 3), dtype=torch.uint8, device="cuda")
    frames[:, 96:480, 160:352] = 200  # a bright upright block on black
    alpha = m(frames)
    assert alpha.shape == (5, 512, 512) and alpha.dtype == torch.uint8 and alpha.is_cuda
    m.reset()
