"""Real-ESRGAN compact 2x for live frames: SRVGGNetCompact, fp16 CUDA, one batch per chunk.

Weights (xinntao/Real-ESRGAN release assets, BSD-3-Clause, pinned by sha256):
- `x4v3`  realesr-general-x4v3.pth (64 feat, 32 convs, x4, general photo): run at 512 -> 2048, then an
          exact 2x2 area average to 1024. The shipped variant.
- `xsx2`  RealESRGANv2-animevideo-xsx2.pth (native x2, anime-trained): measured for the A/B only.
The arch is inlined (it is ~30 lines upstream, realesrgan/archs/srvgg_arch.py) so basicsr is not needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .weights import download, read_rows, upscale_dir, write_rows

if TYPE_CHECKING:
    import torch

LICENCE = "BSD-3-Clause (xinntao/Real-ESRGAN LICENSE; weights are its release assets)"


@dataclass(frozen=True)
class Variant:
    file: str
    url: str
    sha256: str
    out_scale: int  # the network's own factor; anything above 2 is area-averaged down to 2


VARIANTS: dict[str, Variant] = {
    "x4v3": Variant(
        "realesr-general-x4v3.pth",
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
        "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292", 4),
    "xsx2": Variant(
        "RealESRGANv2-animevideo-xsx2.pth",
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.3.0/RealESRGANv2-animevideo-xsx2.pth",
        "27985aa2198711ecd72f9bb274ec7b164e018fc9ce2933daaa7c7ab36a2bd3fe", 2),
}
DEFAULT_VARIANT = "x4v3"


def weights_path(variant: str = DEFAULT_VARIANT) -> Path:
    return upscale_dir() / VARIANTS[variant].file


def fetch(variant: str = DEFAULT_VARIANT) -> Path:
    """Download the pinned weights (a few MB) and record the licence row; idempotent."""
    v = VARIANTS[variant]
    path = download(v.url, weights_path(variant), v.sha256)
    row = {"name": f"xinntao/Real-ESRGAN {v.file}", "licence": LICENCE, "url": v.url,
           "revision": f"sha256:{v.sha256}"}
    if row not in read_rows():
        write_rows([row])
    return path


def build_net(state: dict):
    """SRVGGNetCompact with its shape read from the state dict (feat, convs and scale)."""
    import torch
    from torch import nn
    from torch.nn import functional as F

    body = sorted({int(k.split(".")[1]) for k in state if k.startswith("body.")})
    first, last = state["body.0.weight"], state[f"body.{body[-1]}.weight"]
    num_feat, num_in = first.shape[0], first.shape[1]
    num_conv = (len(body) - 3) // 2  # first conv + act, num_conv x (conv + act), last conv
    scale = int(round((last.shape[0] / num_in) ** 0.5))

    class SRVGGNetCompact(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.scale = scale
            layers: list[nn.Module] = [nn.Conv2d(num_in, num_feat, 3, 1, 1), nn.PReLU(num_feat)]
            for _ in range(num_conv):
                layers += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_feat)]
            layers.append(nn.Conv2d(num_feat, num_in * scale * scale, 3, 1, 1))
            self.body = nn.ModuleList(layers)
            self.upsampler = nn.PixelShuffle(scale)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            out = x
            for layer in self.body:
                out = layer(out)
            return self.upsampler(out) + F.interpolate(x, scale_factor=self.scale, mode="nearest")

    net = SRVGGNetCompact()
    net.load_state_dict(state, strict=True)
    return net


def load_state(path: Path) -> dict:
    import torch

    ckpt = torch.load(str(path), map_location="cpu", weights_only=True)
    for key in ("params_ema", "params"):
        if isinstance(ckpt, dict) and key in ckpt:
            return ckpt[key]
    return ckpt


class RealEsrganUpscaler:
    """uint8 CUDA (N,H,W,3) -> (N,2H,2W,3). `batch` frames go through the net at once (a chunk is 24)."""

    kind = "realesrgan"
    scale = 2

    def __init__(self, variant: str = DEFAULT_VARIANT, batch: int = 24, device: str = "cuda") -> None:
        if variant not in VARIANTS:
            raise ValueError(f"unknown realesrgan variant {variant!r}; expected one of {tuple(VARIANTS)}")
        self.variant, self.batch, self.device = variant, batch, device
        self.net = None

    def _load(self) -> None:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("realesrgan: needs a CUDA GPU")
        net = build_net(load_state(fetch(self.variant)))
        self.net = net.to(self.device, torch.float16).to(memory_format=torch.channels_last).eval()

    def warmup(self) -> None:
        """Load the net and run one full chunk so cuDNN picks its kernels before the first line."""
        import torch

        if self.net is None:
            self._load()
        dummy = torch.zeros((24, 512, 512, 3), dtype=torch.uint8, device=self.device)
        for _ in range(2):
            self(dummy)
        torch.cuda.synchronize()

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor":
        import torch
        from torch.nn import functional as F

        if self.net is None:
            self._load()
        n, h, w, _ = frames.shape
        out = torch.empty((n, h * 2, w * 2, 3), dtype=torch.uint8, device=frames.device)
        # cuDNN autotuning scoped to this net, so the FlashHead process keeps its own setting
        with torch.inference_mode(), torch.backends.cudnn.flags(enabled=True, benchmark=True):
            for i in range(0, n, self.batch):
                x = frames[i:i + self.batch].to(self.device).permute(0, 3, 1, 2)
                x = x.to(torch.float16).div_(255).contiguous(memory_format=torch.channels_last)
                y = self.net(x)
                if self.net.scale > 2:
                    y = F.avg_pool2d(y, self.net.scale // 2)  # exact area downscale to 2x
                y = y.clamp_(0, 1).mul_(255).round_().to(torch.uint8)
                out[i:i + self.batch] = y.permute(0, 2, 3, 1)
        return out
