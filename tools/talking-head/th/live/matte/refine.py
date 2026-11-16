"""Alpha refinement shared by every matte kind: a colour-guided upsample of the network's low-res alpha
to the frame size (He & Sun's fast guided filter), then temporal smoothing gated by the colour frame.

All functions take float32 CUDA (or CPU) tensors in [0, 1], NCHW.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import torch


def box(x: "torch.Tensor", r: int) -> "torch.Tensor":
    """Mean over a (2r+1)^2 window; edges average only the pixels inside the frame."""
    from torch.nn import functional as F

    return F.avg_pool2d(x, 2 * r + 1, stride=1, padding=r, count_include_pad=False)


def guided_coeffs(guide: "torch.Tensor", src: "torch.Tensor", r: int, eps: float):
    """Colour guided filter coefficients (a: N,3,h,w; b: N,1,h,w), already box-averaged, such that
    q = sum(a * guide) + b. `guide` is N,3,h,w and `src` N,1,h,w at the same size."""
    import torch

    mean_i = box(guide, r)
    mean_p = box(src, r)
    cov_ip = box(guide * src, r) - mean_i * mean_p                       # N,3,h,w
    pairs = [(0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2)]
    prods = torch.cat([guide[:, i:i + 1] * guide[:, j:j + 1] for i, j in pairs], 1)
    var = box(prods, r) - torch.cat([mean_i[:, i:i + 1] * mean_i[:, j:j + 1] for i, j in pairs], 1)
    n, _, h, w = guide.shape
    sigma = torch.empty((n, h, w, 3, 3), dtype=guide.dtype, device=guide.device)
    v = var.permute(0, 2, 3, 1)
    for k, (i, j) in enumerate(pairs):
        sigma[..., i, j] = v[..., k]
        sigma[..., j, i] = v[..., k]
    sigma += eps * torch.eye(3, dtype=guide.dtype, device=guide.device)
    a = torch.linalg.solve(sigma, cov_ip.permute(0, 2, 3, 1).unsqueeze(-1)).squeeze(-1)
    a = a.permute(0, 3, 1, 2).contiguous()                               # N,3,h,w
    b = mean_p - (a * mean_i).sum(1, keepdim=True)
    return box(a, r), box(b, r)


def guided_upsample(guide_full: "torch.Tensor", src_low: "torch.Tensor", r: int = 4,
                    eps: float = 1e-3) -> "torch.Tensor":
    """Fast guided filter: coefficients at src_low's size from the downsampled guide, applied to the
    full-size guide, so the alpha edge follows the colour edge (hair strands) instead of the bilinear
    blur of a low-res mask. Returns N,1,H,W clamped to [0, 1]."""
    from torch.nn import functional as F

    h, w = src_low.shape[-2:]
    full_h, full_w = guide_full.shape[-2:]
    guide_low = guide_full if (h, w) == (full_h, full_w) else F.interpolate(
        guide_full, size=(h, w), mode="area")
    a, b = guided_coeffs(guide_low, src_low, r, eps)
    if (h, w) != (full_h, full_w):
        a = F.interpolate(a, size=(full_h, full_w), mode="bilinear", align_corners=False)
        b = F.interpolate(b, size=(full_h, full_w), mode="bilinear", align_corners=False)
    return ((a * guide_full).sum(1, keepdim=True) + b).clamp_(0, 1)


class TemporalSmoother:
    """EMA on the alpha, gated by the colour frame: where the picture is still the alpha moves slowly
    (k_min of the new value per frame, which kills edge flicker); where the colour changed by `thr`
    or more (the head moved) it takes the new alpha at once, so moving edges do not lag or ghost.
    State carries across chunks; reset() at a cut."""

    def __init__(self, k_min: float = 0.35, thr: float = 0.06, r: int = 2) -> None:
        self.k_min, self.thr, self.r = k_min, thr, r
        self.prev_rgb: "torch.Tensor | None" = None
        self.prev_alpha: "torch.Tensor | None" = None

    def reset(self) -> None:
        self.prev_rgb = self.prev_alpha = None

    def __call__(self, rgb: "torch.Tensor", alpha: "torch.Tensor") -> "torch.Tensor":
        """rgb N,3,H,W and alpha N,1,H,W (float [0, 1]) -> smoothed alpha N,1,H,W."""
        import torch

        if self.k_min >= 1.0:
            return alpha
        n = rgb.shape[0]
        if self.prev_rgb is not None and self.prev_rgb.shape[-2:] != rgb.shape[-2:]:
            self.reset()
        prev_rgb = torch.cat([rgb[:1] if self.prev_rgb is None else self.prev_rgb, rgb[:-1]])
        # per-pixel colour change to the previous frame, spread a little so a moving edge's
        # neighbourhood also follows the new alpha
        change = box((rgb - prev_rgb).abs().amax(1, keepdim=True), self.r)
        k = (self.k_min + (1 - self.k_min) * (change / self.thr).clamp(0, 1))
        out = torch.empty_like(alpha)
        last = alpha[:1] if self.prev_alpha is None else self.prev_alpha
        for t in range(n):
            last = k[t:t + 1] * alpha[t:t + 1] + (1 - k[t:t + 1]) * last
            out[t:t + 1] = last
        self.prev_rgb, self.prev_alpha = rgb[-1:].clone(), last.clone()
        return out
