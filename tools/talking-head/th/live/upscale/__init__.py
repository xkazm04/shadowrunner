"""Upscalers applied to FlashHead frames before they are sent (design "Interfaces").

Contract: uint8 CUDA tensor (N,H,W,3) in, (N,H*scale,W*scale,3) out. `none` is the identity. Task 2
replaces realesrgan.py and maxine.py; this module and its registry are Director-owned.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import torch

KINDS = ("none", "realesrgan", "maxine", "iris")


class Upscaler(Protocol):
    kind: str
    scale: int

    def warmup(self) -> None: ...

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor": ...


class NoUpscale:
    kind = "none"
    scale = 1

    def warmup(self) -> None:
        return None

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor":
        return frames


def get_upscaler(kind: str) -> Upscaler:
    """The upscaler for `kind`; raises ValueError for an unknown kind."""
    if kind == "none":
        return NoUpscale()
    if kind == "realesrgan":
        from .realesrgan import RealEsrganUpscaler

        return RealEsrganUpscaler()
    if kind == "maxine":
        from .maxine import MaxineUpscaler

        return MaxineUpscaler()
    if kind == "iris":
        from .iris import IrisUpscaler

        return IrisUpscaler()
    raise ValueError(f"unknown upscaler {kind!r}; expected one of {KINDS}")
