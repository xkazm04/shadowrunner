"""Live upscalers (th/live/upscale): the inline SRVGGNetCompact on CPU, the shared licence.json, and
the real upscalers on CUDA (skipped without CUDA or without the weights / the nvidia-vfx wheel)."""

from __future__ import annotations

import json

import pytest

torch = pytest.importorskip("torch")

from th.live.upscale import get_upscaler  # noqa: E402
from th.live.upscale import maxine, realesrgan, weights  # noqa: E402

HAS_CUDA = torch.cuda.is_available()


def _state(num_feat: int, num_conv: int, scale: int) -> dict:
    """A random SRVGGNetCompact state dict laid out as the upstream checkpoints are."""
    layers = [(3, num_feat)] + [(num_feat, num_feat)] * num_conv + [(num_feat, 3 * scale * scale)]
    state, idx = {}, 0
    for i, (cin, cout) in enumerate(layers):
        state[f"body.{idx}.weight"] = torch.randn(cout, cin, 3, 3) * 0.01
        state[f"body.{idx}.bias"] = torch.zeros(cout)
        idx += 1
        if i < len(layers) - 1:
            state[f"body.{idx}.weight"] = torch.full((cout,), 0.25)  # PReLU
            idx += 1
    return state


@pytest.mark.parametrize("scale", [2, 4])
def test_build_net_reads_shape_from_state(scale):
    net = realesrgan.build_net(_state(8, 3, scale)).eval()
    assert net.scale == scale
    x = torch.rand(1, 3, 16, 16)
    with torch.inference_mode():
        y = net(x)
    assert y.shape == (1, 3, 16 * scale, 16 * scale)
    # near-zero body weights: the output is the nearest-neighbour base the net adds its residual to
    base = torch.nn.functional.interpolate(x, scale_factor=scale, mode="nearest")
    assert torch.allclose(y, base, atol=0.05)


def test_registry_kinds():
    assert get_upscaler("none").scale == 1
    assert get_upscaler("realesrgan").kind == "realesrgan"
    assert get_upscaler("realesrgan").scale == 2
    assert get_upscaler("maxine").kind == "maxine"
    with pytest.raises(ValueError):
        get_upscaler("bogus")
    with pytest.raises(ValueError):
        realesrgan.RealEsrganUpscaler("bogus")


def test_licence_rows_merge_by_name(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    weights.write_rows([{"name": "a", "licence": "x", "url": "u", "revision": "1"}])
    weights.write_rows([{"name": "b", "licence": "y", "url": "u", "revision": "2"},
                        {"name": "a", "licence": "x2", "url": "u", "revision": "3"}])
    rows = json.loads((tmp_path / "models" / "live-upscale" / "licence.json").read_text("utf-8"))
    assert sorted((r["name"], r["revision"]) for r in rows) == [("a", "3"), ("b", "2")]


def test_maxine_without_the_wheel_names_the_fix(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    monkeypatch.setitem(__import__("sys").modules, "nvvfx", None)  # import nvvfx -> ImportError
    with pytest.raises(RuntimeError, match="th.live.upscale.maxine fetch"):
        maxine._import_nvvfx()


def test_every_wheel_is_pinned():
    for name, sha in maxine.WHEELS.values():
        assert name.startswith(f"nvidia_vfx-{maxine.VERSION}-") and len(sha) == 64
    for v in realesrgan.VARIANTS.values():
        assert len(v.sha256) == 64


def _frames():
    g = torch.Generator().manual_seed(0)
    x = torch.rand((24, 3, 64, 64), generator=g)
    x = torch.nn.functional.interpolate(x, size=(512, 512), mode="bilinear")  # smooth, image-like
    return (x * 255).round().to(torch.uint8).permute(0, 2, 3, 1).contiguous().cuda()


def _check_2x(up, frames):
    out = up(frames)
    torch.cuda.synchronize()
    assert out.shape == (24, 1024, 1024, 3) and out.dtype == torch.uint8 and out.is_cuda
    ref = torch.nn.functional.interpolate(frames.permute(0, 3, 1, 2).float(), scale_factor=2,
                                          mode="bicubic")
    err = (out.permute(0, 3, 1, 2).float() - ref).abs().mean().item()
    assert err < 12, f"{up.kind}: mean abs deviation from bicubic {err:.1f}"  # same picture, sharper


@pytest.mark.skipif(not HAS_CUDA or not realesrgan.weights_path().is_file(),
                    reason="needs CUDA and the realesrgan weights (fetched on first use)")
def test_realesrgan_on_cuda():
    up = get_upscaler("realesrgan")
    up.warmup()
    _check_2x(up, _frames())


@pytest.mark.skipif(not HAS_CUDA or not (maxine.target_dir() / "nvvfx").is_dir(),
                    reason="needs CUDA and `python -m th.live.upscale.maxine fetch`")
def test_maxine_on_cuda():
    up = get_upscaler("maxine")
    up.warmup()
    try:
        _check_2x(up, _frames())
    finally:
        up.close()
