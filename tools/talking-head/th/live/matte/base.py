"""The pipeline every matte kind shares: uint8 CUDA (N,H,W,3) -> network alpha at the kind's own
resolution -> colour-guided upsample to H,W -> temporal smoothing -> uint8 CUDA (N,H,W), 255 = opaque.
A kind only implements `_load` and `_infer`."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .refine import TemporalSmoother, guided_upsample

if TYPE_CHECKING:
    import torch


class BaseMatte:
    kind = "base"

    def __init__(self, res: int = 512, guide_r: int = 4, eps: float = 1e-3, smooth: float = 0.35,
                 stride: int = 1, batch: int = 24, device: str = "cuda") -> None:
        self.res, self.guide_r, self.eps, self.batch, self.device = res, guide_r, eps, batch, device
        self.stride = max(1, int(stride))
        self.smoother = TemporalSmoother(k_min=smooth)
        self.loaded = False

    # -- per kind -----------------------------------------------------------------------------
    def _load(self) -> None:
        raise NotImplementedError

    def _infer(self, rgb: "torch.Tensor", frames: "torch.Tensor") -> "torch.Tensor":
        """rgb float N,3,H,W in [0, 1] (and the uint8 frames it came from) -> alpha float N,1,h,w."""
        raise NotImplementedError

    # -- shared -------------------------------------------------------------------------------
    def _ensure(self) -> None:
        if not self.loaded:
            self._load()
            self.loaded = True

    def reset(self) -> None:
        """Forget the temporal state (a cut, or a new session)."""
        self.smoother.reset()

    def warmup(self) -> None:
        """Load and run one full chunk twice so kernels are picked before the first line."""
        import torch

        self._ensure()
        dummy = torch.zeros((24, 512, 512, 3), dtype=torch.uint8, device=self.device)
        for _ in range(2):
            self(dummy)
        if self.device.startswith("cuda"):
            torch.cuda.synchronize()
        self.reset()

    def alpha_float(self, frames: "torch.Tensor") -> "torch.Tensor":
        """uint8 (N,H,W,3) -> float N,1,H,W in [0, 1] (refined and smoothed)."""
        import torch
        from torch.nn import functional as F

        self._ensure()
        with torch.inference_mode():
            if not isinstance(frames, torch.Tensor):  # tolerate a host array (the result is CUDA)
                frames = torch.from_numpy(frames)
            frames = frames.to(self.device)
            rgb = frames.permute(0, 3, 1, 2).float().div_(255)
            low = self._strided(rgb, frames)
            if self.guide_r > 0:
                alpha = guided_upsample(rgb, low, self.guide_r, self.eps)
            elif low.shape[-2:] != rgb.shape[-2:]:
                alpha = F.interpolate(low, size=rgb.shape[-2:], mode="bilinear", align_corners=False)
            else:
                alpha = low
            return self.smoother(rgb, alpha.clamp(0, 1))

    def _strided(self, rgb: "torch.Tensor", frames: "torch.Tensor") -> "torch.Tensor":
        """The network on every `stride`-th frame (and the chunk's last), linearly interpolated in
        time between them; the guided filter then snaps each frame's edge to its own colour."""
        import torch

        n = rgb.shape[0]
        if self.stride == 1 or n <= 2:
            return self._infer(rgb, frames).float()
        keys = sorted(set(range(0, n, self.stride)) | {n - 1})
        idx = torch.tensor(keys, device=rgb.device)
        low_k = self._infer(rgb[idx], frames[idx]).float()
        out = torch.empty((n, *low_k.shape[1:]), dtype=low_k.dtype, device=low_k.device)
        for j, (k0, k1) in enumerate(zip(keys, keys[1:])):
            for t in range(k0, k1 + 1):
                w = (t - k0) / (k1 - k0)
                out[t] = low_k[j] * (1 - w) + low_k[j + 1] * w
        return out

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor":
        import torch

        alpha = self.alpha_float(frames)
        return (alpha.squeeze(1) * 255 + 0.5).to(torch.uint8)
