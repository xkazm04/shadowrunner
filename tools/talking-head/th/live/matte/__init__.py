"""Live matting for a transparent Iris (round 2). The registry is Director-owned; the matting task
fills in the kinds. Contract: uint8 CUDA (N,H,W,3) frames in, uint8 CUDA (N,H,W) alpha out (255 = opaque).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import torch


class Matte(Protocol):
    kind: str

    def warmup(self) -> None: ...

    def __call__(self, frames: "torch.Tensor") -> "torch.Tensor": ...


def get_matte(kind: str) -> Matte:
    """The matte for `kind`; the matting task registers its kinds in `kinds.py`."""
    from .kinds import KINDS

    if kind not in KINDS:
        raise ValueError(f"unknown matte {kind!r}; expected one of {tuple(KINDS)}")
    return KINDS[kind]()
