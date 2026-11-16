"""Iris sharpener (th/live/upscale/iris*.py, train_iris.py): the inline net, its checkpoint and licence
row, the training-pair geometry and metrics on CPU, and the real upscaler on CUDA (skipped without
CUDA or without the trained weights)."""

from __future__ import annotations

import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from th.live.models import BUST_BOX  # noqa: E402
from th.live.upscale import get_upscaler, iris, iris_data, train_iris  # noqa: E402

HAS_CUDA = torch.cuda.is_available()
F = torch.nn.functional


def test_untrained_net_is_a_bilinear_2x():
    net = iris.build_net(8, 2).eval()
    x = torch.rand(1, 3, 16, 16)
    with torch.inference_mode():
        y = net(x)
    assert y.shape == (1, 3, 32, 32)
    assert torch.allclose(y, F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False))


def test_checkpoint_roundtrip_and_licence_row(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    net = iris.build_net(8, 3)
    with torch.no_grad():
        for p in net.parameters():
            p.add_(torch.randn_like(p) * 0.01)
    path = iris.weights_path()
    iris.save(net, path, {"step": 1})
    iris.record_licence(path)
    back = iris.load_net(path)
    assert (back.body[0].out_channels, len(back.body)) == (8, 2 + 3 * 2 + 1)
    for (k, a), (_, b) in zip(net.state_dict().items(), back.state_dict().items()):
        assert torch.equal(a, b), k
    rows = json.loads((path.parent / "licence.json").read_text("utf-8"))
    row = next(r for r in rows if r["name"] == iris.ROW_NAME)
    assert "own model" in row["licence"] and "docs/provenance.md" in row["licence"]
    assert row["revision"] == "sha256:" + iris.sha256_of(path)
    iris.record_licence(path)  # idempotent: one row per name
    rows = json.loads((path.parent / "licence.json").read_text("utf-8"))
    assert sum(r["name"] == iris.ROW_NAME for r in rows) == 1


def test_missing_weights_name_the_trainer(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    with pytest.raises(RuntimeError, match="train_iris"):
        iris.load_net()


def test_sources_skip_cutouts_and_hold_out_three():
    names = [n for n, _ in iris_data.sources()]
    assert names[0] == "portrait" and len(names) == len(set(names))
    assert not set(iris_data.NOT_FACES) & set(names)
    train, val = iris_data.split()
    assert sorted(n for n, _ in val) == sorted(iris_data.HOLDOUT)
    assert not {n for n, _ in train} & set(iris_data.HOLDOUT)


def test_trajectory_bounds_and_still():
    rng = np.random.default_rng(0)
    for _ in range(50):
        t = iris_data.trajectory(rng)
        assert t.shape == (iris_data.CLIP, 3)
        assert np.abs(t[:, :2]).max() <= iris_data.SHIFT
        assert np.abs(t[:, 2] - 1).max() <= iris_data.SCALE + 1e-9
    assert np.array_equal(iris_data.trajectory(rng, still=True)[0], [0.0, 0.0, 1.0])


def test_render_still_is_the_bust_box():
    # a horizontal ramp: the still crop's columns must span exactly the bust box's x range
    ramp = torch.linspace(0, 1, 1024).view(1, 1, 1, 1024).expand(1, 3, 1024, 1024).contiguous()
    still = torch.from_numpy(iris_data.trajectory(np.random.default_rng(0), n=1, still=True)).float()
    out = iris_data.render(ramp[0], still, flip=False, size=64)
    x0, _, x1, _ = BUST_BOX
    assert abs(out[0, 0, 32, 0].item() - (x0 + 5) / 1023) < 0.01
    assert abs(out[0, 0, 32, -1].item() - (x1 - 5) / 1023) < 0.01
    flipped = iris_data.render(ramp[0], still, flip=True, size=64)
    assert torch.allclose(flipped, out.flip(-1), atol=1e-4)


def test_blur_metrics():
    x = torch.rand(2, 3, 32, 32)
    flat = torch.full((2, 3, 32, 32), 0.4)
    assert torch.allclose(iris_data.gauss_blur(flat, torch.tensor([0.3, 0.8])), flat, atol=1e-6)
    soft = iris_data.gauss_blur(x, 0.8)
    grey = iris_data.to_grey255(x)
    assert iris_data.lap_var(iris_data.to_grey255(soft)).mean() < iris_data.lap_var(grey).mean()
    assert iris_data.ssim(grey / 255, grey / 255) == pytest.approx(1.0, abs=1e-4)
    assert iris_data.psnr(x, x) == 99.0
    assert 10 < iris_data.psnr(x, soft) < 40


def test_training_helpers():
    assert train_iris.lr_at(0) == pytest.approx(1e-3)
    assert train_iris.lr_at(1) == pytest.approx(2e-5)
    assert train_iris.lr_at(2) == pytest.approx(2e-5)
    a = torch.rand(2, 3, 16, 16)
    assert train_iris.fft_l1(a, a).item() == 0
    if HAS_CUDA:
        gen = torch.Generator(device="cuda").manual_seed(0)
        out = train_iris.jitter(a.cuda(), gen)
        assert out.shape == a.shape and 0 <= out.min() and out.max() <= 1


@pytest.mark.skipif(not HAS_CUDA or not iris.weights_path().is_file(),
                    reason="needs CUDA and the trained weights (python -m th.live.upscale.train_iris)")
def test_iris_on_cuda():
    up = get_upscaler("iris")
    assert (up.kind, up.scale) == ("iris", 2)
    up.warmup()
    g = torch.Generator().manual_seed(0)
    x = F.interpolate(torch.rand((24, 3, 64, 64), generator=g), size=(512, 512), mode="bilinear")
    frames = (x * 255).round().to(torch.uint8).permute(0, 2, 3, 1).contiguous().cuda()
    out = up(frames)
    torch.cuda.synchronize()
    assert out.shape == (24, 1024, 1024, 3) and out.dtype == torch.uint8 and out.is_cuda
    ref = F.interpolate(frames.permute(0, 3, 1, 2).float(), scale_factor=2, mode="bicubic")
    err = (out.permute(0, 3, 1, 2).float() - ref).abs().mean().item()
    assert err < 12, f"iris: mean abs deviation from bicubic {err:.1f}"  # same picture, sharper


def test_eval_arms_and_sheet(tmp_path, monkeypatch):
    from th.live.upscale import iris_eval

    monkeypatch.setenv("TH_HOME", str(tmp_path))
    assert iris_eval.make_arm("iris").path == iris.weights_path()
    assert iris_eval.make_arm("iris-tex").path.name == "iris-x2-tex.pth"
    assert iris_eval.make_arm("bicubic").kind == "bicubic"
    img = torch.rand(3, 1024, 1024)
    rows = [(e, n, img) for e in iris_data.HOLDOUT for n in ("truth", "bicubic")]
    out = iris_eval.sheet(rows, ["truth", "bicubic"])
    per = len(iris_data.HOLDOUT) * len(iris_eval.REGIONS)
    assert out.shape == (per * 256 + (per - 1) * 4, 2 * 384 + 4, 3) and out.dtype == np.uint8


def test_gan_term_steps_on_cpu():
    from th.live.upscale import iris_gan

    adv = iris_gan.GanTerm(device="cpu")
    real, fake = torch.rand(2, 3, 64, 64), torch.rand(2, 3, 64, 64, requires_grad=True)
    assert adv.disc(real).shape == (2, 1, 8, 8)
    g = adv.g_loss(fake)
    g.backward()
    assert fake.grad is not None and all(p.grad is None for p in adv.disc.parameters())
    before = [p.detach().clone() for p in adv.disc.parameters()]
    assert adv.d_step(fake, real) > 0
    assert any(not torch.equal(a, b) for a, b in zip(before, adv.disc.parameters()))
    adv.load_state_dict(adv.state_dict())
