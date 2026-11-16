"""Training pairs for the Iris sharpener: (FlashHead-soft 512, true 1024) built from Iris's own art.

- Sources: her 1024 portrait and the Codex edits in assets/characters/companions/iris/edits/, minus
  the two green-screen cut-outs (`head`, `matte`: not faces on her ground). HOLDOUT edits never train.
- Target: the live bust box (192,140)-(832,780), resized to 1024. A clip is 9 frames whose box
  drifts smoothly (shift up to +-SHIFT px, scale 1 +- SCALE, one flip per clip), like a head moving.
- Input: the target area-downsampled to 512, pre-blurred (BLUR), then encoded and decoded as one
  9-frame clip by FlashHead Lite's own VAE (VAE_LTX, loaded the way its pipeline does), so the net
  learns the softness of FlashHead's decoder rather than a fixed blur. More jitter is added online.

`build` runs in the FlashHead env (the VAE's code lives in its repo); the rest is plain torch.
Targets are not stored: each is re-rendered on the GPU from the source and the clip's boxes.
"""

from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

from ...paths import portrait_path, th_home
from ..models import BUST_BOX, FH_CKPT, FH_REPO

if TYPE_CHECKING:
    import torch

HOLDOUT = ("joy", "teeth", "gazeL")
NOT_FACES = ("head", "matte")  # green-screen cut-outs, checked by eye on the contact sheet
FACE_BOX_512 = (122, 80, 386, 382)  # MediaPipe face box on live-bench frames (median) and on the bust
CLIP = 9  # LTX VAE: 1 + 8k frames per causal clip
SHIFT = 24.0  # portrait px
SCALE = 0.06
HR, LR = 1024, 512
# pre-VAE Gaussian sigma (512 px): the VAE alone leaves the face at Laplacian variance ~145, live
# FlashHead frames sit at 57-88 (speech p10-p90, idle ~84); sigma 0.5 + VAE gives ~78
BLUR = (0.4, 0.62)
BLUR_STILL = 0.5


def sources() -> list[tuple[str, Path]]:
    """(name, path) of every usable 1024 image: the portrait first, then the edits by name."""
    p = portrait_path()
    out = [("portrait", p)]
    for f in sorted((p.parent / "edits").glob("*.webp")):
        if f.stem not in NOT_FACES:
            out.append((f.stem, f))
    return out


def split() -> tuple[list[tuple[str, Path]], list[tuple[str, Path]]]:
    src = sources()
    return [s for s in src if s[0] not in HOLDOUT], [s for s in src if s[0] in HOLDOUT]


def load_rgb(path: Path) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"))


def trajectory(rng: np.random.Generator, n: int = CLIP, still: bool = False) -> np.ndarray:
    """(n, 3) of (dx, dy, scale): a smooth drift from a random start; `still` is the bare bust box."""
    if still:
        return np.tile([0.0, 0.0, 1.0], (n, 1))
    start = np.array([rng.uniform(-SHIFT, SHIFT), rng.uniform(-SHIFT, SHIFT), 1 + rng.uniform(-SCALE, SCALE)])
    step = np.array([rng.normal(0, 1.2), rng.normal(0, 1.2), rng.normal(0, 0.002)])
    t = start + np.arange(n)[:, None] * step[None]
    t[:, :2] = t[:, :2].clip(-SHIFT, SHIFT)
    t[:, 2] = t[:, 2].clip(1 - SCALE, 1 + SCALE)
    return t


def render(src: "torch.Tensor", traj: "torch.Tensor", flip: bool, size: int = HR) -> "torch.Tensor":
    """Float (3,1024,1024) source in 0..1 -> (n,3,size,size) crops of the bust box moved by `traj`."""
    import torch
    from torch.nn import functional as F

    x0, y0, x1, y1 = BUST_BOX
    W = src.shape[-1]
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2
    n = traj.shape[0]
    theta = torch.zeros((n, 2, 3), device=src.device, dtype=torch.float32)
    s = traj[:, 2] * half / (W / 2)  # half-size in normalised coords
    theta[:, 0, 0] = -s if flip else s
    theta[:, 1, 1] = s
    theta[:, 0, 2] = (cx + traj[:, 0] - W / 2) / (W / 2)
    theta[:, 1, 2] = (cy + traj[:, 1] - W / 2) / (W / 2)
    grid = F.affine_grid(theta, (n, 3, size, size), align_corners=False)
    out = F.grid_sample(src.expand(n, -1, -1, -1), grid, mode="bicubic", padding_mode="border",
                        align_corners=False)
    return out.clamp_(0, 1)


def gauss_blur(x: "torch.Tensor", sigma: "torch.Tensor | float") -> "torch.Tensor":
    """Per-sample separable Gaussian blur; sigma (n,) or a float, in px; sigma < 0.05 is identity."""
    import torch
    from torch.nn import functional as F

    n, c, h, w = x.shape
    sig = torch.as_tensor(sigma, dtype=x.dtype, device=x.device).reshape(-1).expand(n).clamp(min=1e-3)
    r = 3
    k = torch.arange(-r, r + 1, device=x.device, dtype=x.dtype)
    g = torch.exp(-(k[None] ** 2) / (2 * sig[:, None] ** 2))
    g = g / g.sum(1, keepdim=True)  # (n, 7)
    y = x.reshape(1, n * c, h, w)
    gx = g.repeat_interleave(c, 0).view(n * c, 1, 1, 2 * r + 1)
    y = F.conv2d(F.pad(y, (r, r, 0, 0), mode="reflect"), gx, groups=n * c)
    y = F.conv2d(F.pad(y, (0, 0, r, r), mode="reflect"), gx.transpose(2, 3), groups=n * c)
    return y.view(n, c, h, w)


def downsample(hr: "torch.Tensor") -> "torch.Tensor":
    from torch.nn import functional as F

    return F.avg_pool2d(hr, 2)


def lap_var(grey: "torch.Tensor") -> "torch.Tensor":
    """Variance of the Laplacian per image, grey (n,1,h,w) on a 0..255 scale (as ab.py measures)."""
    import torch
    from torch.nn import functional as F

    k = torch.tensor([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=grey.dtype, device=grey.device).view(1, 1, 3, 3)
    return F.conv2d(grey, k).flatten(1).var(dim=1)


def to_grey255(x: "torch.Tensor") -> "torch.Tensor":
    """(n,3,h,w) 0..1 -> (n,1,h,w) 0..255."""
    return (x[:, 0:1] * 0.299 + x[:, 1:2] * 0.587 + x[:, 2:3] * 0.114) * 255


def face_sharpness(x: "torch.Tensor", scale: int = 1) -> list[float]:
    """Laplacian variance on the face box, per frame; x is (n,3,512*scale,512*scale) in 0..1."""
    a, b, c, d = (v * scale for v in FACE_BOX_512)
    return lap_var(to_grey255(x[:, :, b:d, a:c])).tolist()


class Vae:
    """FlashHead Lite's LTX VAE, bf16 on CUDA, loaded from $TH_HOME exactly as its pipeline does."""

    def __init__(self, device: str = "cuda") -> None:
        import torch

        repo = th_home() / "repos" / FH_REPO
        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))
        from flash_head.ltx_video.ltx_vae import LtxVAE

        self.vae = LtxVAE(str(th_home() / "models" / FH_REPO / FH_CKPT / "VAE_LTX"),
                          dtype=torch.bfloat16, device=device)

    def roundtrip(self, clip: "torch.Tensor") -> "torch.Tensor":
        """(T,3,512,512) 0..1 -> the same after encode + decode (T = 1 + 8k)."""
        import torch

        with torch.inference_mode():
            v = (clip.permute(1, 0, 2, 3).unsqueeze(0) * 2 - 1).to(torch.bfloat16)
            out = self.vae.decode(self.vae.encode(v))  # (1,3,T,H,W) in -1..1
            return ((out[0].float().permute(1, 0, 2, 3) + 1) / 2).clamp_(0, 1)


def build(out: Path, clips: int, seed: int = 1116, device: str = "cuda") -> dict:
    """Write out/<name>.npz (lr uint8 (k,9,512,512,3), traj (k,9,3), flip (k,)) for every source.

    Clip 0 of each source is the still bust box (no flip, BLUR_STILL): the exact live framing."""
    import torch

    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    vae = Vae(device)
    meta: dict = {"seed": seed, "clips": clips, "holdout": list(HOLDOUT), "sources": {}}
    for name, path in sources():
        src = torch.from_numpy(load_rgb(path)).to(device).permute(2, 0, 1).float().div_(255)[None]
        lrs, trajs, flips, blurs = [], [], [], []
        for k in range(clips):
            still = k == 0
            traj = trajectory(rng, still=still)
            flip = bool(not still and rng.random() < 0.5)
            blur = BLUR_STILL if still else float(rng.uniform(*BLUR))
            hr = render(src, torch.from_numpy(traj).to(device).float(), flip)
            lr = downsample(hr)
            if blur > 0.05:
                lr = gauss_blur(lr, blur)
            lr = Vae.roundtrip(vae, lr)
            lrs.append(lr.mul(255).round().to(torch.uint8).permute(0, 2, 3, 1).cpu().numpy())
            trajs.append(traj)
            flips.append(flip)
            blurs.append(blur)
        np.savez(out / f"{name}.npz", lr=np.stack(lrs), traj=np.stack(trajs).astype(np.float32),
                 flip=np.array(flips), blur=np.array(blurs, np.float32))
        meta["sources"][name] = {"path": str(path), "holdout": name in HOLDOUT}
        print(f"iris-data: {name} {clips} clips", flush=True)
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8", newline="\n")
    del vae
    torch.cuda.empty_cache()
    return meta


def data_dir() -> Path:
    return Path(os.environ.get("TH_IRIS_DATA") or th_home() / "live" / "iris-train")


def psnr(a: "torch.Tensor", b: "torch.Tensor") -> float:
    mse = float(((a - b) ** 2).mean())
    return 99.0 if mse == 0 else 10 * math.log10(1 / mse)


def ssim(a: "torch.Tensor", b: "torch.Tensor") -> float:
    """Mean SSIM of grey (n,1,h,w) images in 0..1 (11-tap Gaussian window, sigma 1.5)."""
    import torch
    from torch.nn import functional as F

    k = torch.arange(11, device=a.device, dtype=a.dtype) - 5
    g = torch.exp(-(k ** 2) / (2 * 1.5 ** 2))
    g = (g / g.sum())
    w = (g[:, None] * g[None]).view(1, 1, 11, 11)
    mu_a, mu_b = F.conv2d(a, w), F.conv2d(b, w)
    va = F.conv2d(a * a, w) - mu_a ** 2
    vb = F.conv2d(b * b, w) - mu_b ** 2
    cov = F.conv2d(a * b, w) - mu_a * mu_b
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    s = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (va + vb + c2))
    return float(s.mean())
