"""Iris-trained 2x sharpener (`--upscale iris`): a compact SRVGG-style net trained from scratch on
Iris's own art (th/live/upscale/train_iris.py), so the project's data is its only provenance.

Weights: $TH_HOME/models/live-upscale/iris-x2.pth ({"arch": {...}, "params": state_dict, ...}),
recorded in licence.json as the project's own model. Not downloadable: train it with
`python -m th.live.upscale.train_iris` (FlashHead env, see the module doc).

The arch is SRVGGNetCompact's shape (conv + PReLU stack, pixel shuffle) with a bilinear base in place
of nearest, so an untrained net is already a smooth 2x and the body learns only the detail.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from .weights import read_rows, sha256_of, upscale_dir, write_rows

if TYPE_CHECKING:
    import torch

FILE = "iris-x2.pth"
ROW_NAME = "iris-x2 (own model)"
LICENCE = ("own model, trained on the project's Iris art; see docs/provenance.md "
           "(from scratch: no pretrained weights, no third-party data)")
ARCH = {"num_feat": 32, "num_conv": 16, "scale": 2}  # ~63 ms per 24-frame chunk (4090, fp16)


def weights_path() -> Path:
    return upscale_dir() / FILE


def build_net(num_feat: int = ARCH["num_feat"], num_conv: int = ARCH["num_conv"], scale: int = 2):
    from torch import nn
    from torch.nn import functional as F

    class IrisNet(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.scale = scale
            layers: list[nn.Module] = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_feat)]
            for _ in range(num_conv):
                layers += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_feat)]
            for m in layers:  # He init for PReLU(0.25): torch's default shrinks the signal ~3x a layer,
                if isinstance(m, nn.Conv2d):  # which leaves a 17-conv plain stack untrainable
                    nn.init.kaiming_normal_(m.weight, a=0.25, nonlinearity="leaky_relu")
                    nn.init.zeros_(m.bias)
            last = nn.Conv2d(num_feat, 3 * scale * scale, 3, 1, 1)
            nn.init.zeros_(last.weight)
            nn.init.zeros_(last.bias)
            layers.append(last)
            self.body = nn.ModuleList(layers)
            self.upsampler = nn.PixelShuffle(scale)

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            out = x
            for layer in self.body:
                out = layer(out)
            base = F.interpolate(x, scale_factor=self.scale, mode="bilinear", align_corners=False)
            return self.upsampler(out) + base

    return IrisNet()


def save(net, path: Path, meta: dict) -> None:
    """Write the checkpoint (arch, params, meta) and the licence row."""
    import torch

    path.parent.mkdir(parents=True, exist_ok=True)
    arch = {"num_feat": net.body[0].out_channels, "num_conv": (len(net.body) - 3) // 2, "scale": net.scale}
    tmp = path.with_suffix(".part")
    torch.save({"arch": arch, "params": {k: v.detach().cpu() for k, v in net.state_dict().items()},
                "meta": meta}, str(tmp))
    tmp.replace(path)


def record_licence(path: Path) -> None:
    rows = [r for r in read_rows() if r.get("name") != ROW_NAME]
    write_rows(rows + [{"name": ROW_NAME, "licence": LICENCE, "url": "local: th/live/upscale/train_iris.py",
                        "revision": f"sha256:{sha256_of(path)}"}])


def load_net(path: Path | None = None):
    import torch

    p = path or weights_path()
    if not p.is_file():
        raise RuntimeError(f"iris: no weights at {p}; train them with `python -m th.live.upscale.train_iris` "
                           "(FlashHead env, see docs/talking-head.md)")
    ckpt = torch.load(str(p), map_location="cpu", weights_only=True)
    net = build_net(**ckpt["arch"])
    net.load_state_dict(ckpt["params"], strict=True)
    return net


class IrisUpscaler:
    """uint8 CUDA (N,512,512,3) -> (N,1024,1024,3): fp16, channels-last, `batch` frames per call
    (4: same ms per chunk as 12 on a 4090, 0.75 GB peak instead of 1.9 GB)."""

    kind = "iris"
    scale = 2

    def __init__(self, path: Path | None = None, batch: int = 4, device: str = "cuda") -> None:
        self.path, self.batch, self.device = path, batch, device
        self.net = None

    def _load(self) -> None:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("iris: needs a CUDA GPU")
        net = load_net(self.path)
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

        if self.net is None:
            self._load()
        n, h, w, _ = frames.shape
        out = torch.empty((n, h * 2, w * 2, 3), dtype=torch.uint8, device=frames.device)
        # cuDNN autotuning scoped to this net, so the FlashHead process keeps its own setting
        with torch.inference_mode(), torch.backends.cudnn.flags(enabled=True, benchmark=True):
            for i in range(0, n, self.batch):
                x = frames[i:i + self.batch].to(self.device).permute(0, 3, 1, 2)
                x = x.to(torch.float16).div_(255).contiguous(memory_format=torch.channels_last)
                y = self.net(x).clamp_(0, 1).mul_(255).round_().to(torch.uint8)
                out[i:i + self.batch] = y.permute(0, 2, 3, 1)
        return out
