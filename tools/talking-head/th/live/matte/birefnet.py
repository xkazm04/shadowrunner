"""BiRefNet mattes (MIT code and weights, ZhengPeng7) on the live 512 frame, fp16 CUDA.

- `birefnet-lite`          BiRefNet_lite (Swin-T, 44 M), general dichotomous segmentation.
- `birefnet-lite-matting`  BiRefNet_lite-matting (Swin-T, 44 M), trained for soft alpha on people
                           (P3M-10k, AM-2k, AIM-500, ...): the hair edge is a matte, not a cut.
- `birefnet`               the offline matte's BiRefNet (Swin-L, 220 M), measured for the A/B only.

The network runs at `res` (area-downsampled) and the colour-guided filter brings the alpha back to
the frame size. Loading goes through transformers' remote code from the pinned local snapshot (the
same way th/post/alpha.py loads it); it imports timm and kornia, so the FlashHead env needs both.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import BaseMatte
from .weights import BIREFNET, fetch_birefnet

if TYPE_CHECKING:
    import torch

_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)


class BiRefNetMatte(BaseMatte):
    def __init__(self, kind: str = "birefnet-lite-matting", res: int = 384, **kw) -> None:
        if kind not in BIREFNET:
            raise ValueError(f"unknown birefnet matte {kind!r}; expected one of {tuple(BIREFNET)}")
        if res % 32:
            raise ValueError(f"birefnet: res must be a multiple of 32, got {res}")
        super().__init__(res=res, **kw)
        self.kind = self.weights = kind  # kinds.py may rename `kind` (a variant of the same weights)
        self.net = None

    def _load(self) -> None:
        import torch
        from transformers import AutoModelForImageSegmentation

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError(f"{self.kind}: needs a CUDA GPU")
        path = fetch_birefnet(self.weights)
        net = AutoModelForImageSegmentation.from_pretrained(str(path), trust_remote_code=True)
        self.dtype = torch.float16 if self.device.startswith("cuda") else torch.float32
        self.net = net.to(self.device, self.dtype).eval()
        self.mean = torch.tensor(_MEAN, device=self.device).view(1, 3, 1, 1)
        self.std = torch.tensor(_STD, device=self.device).view(1, 3, 1, 1)

    def _infer(self, rgb: "torch.Tensor", frames: "torch.Tensor") -> "torch.Tensor":
        import torch
        from torch.nn import functional as F

        x = rgb if rgb.shape[-1] == self.res else F.interpolate(rgb, size=(self.res, self.res),
                                                                mode="area")
        x = ((x - self.mean) / self.std).to(self.dtype)
        outs = []
        # cuDNN autotuning scoped to this net, so the FlashHead process keeps its own setting
        with torch.backends.cudnn.flags(enabled=True, benchmark=True):
            for i in range(0, x.shape[0], self.batch):
                outs.append(self.net(x[i:i + self.batch])[-1].float().sigmoid())
        return torch.cat(outs)
