"""Matte kinds (the matting task owns this file). Each entry builds a fresh Matte with its measured
default settings; `get_matte(kind)` in __init__.py looks them up here. Imports stay lazy so the
registry costs nothing until a kind is built.

The BiRefNet kinds run the network on every 2nd frame (stride 2) and interpolate between: measured on
live-bench output, the in-between frames differ from a per-frame matte by 0.5/255 on average in the
edge band (p99 4/255) and the smoothing hides the alternation, at about half the GPU time.
"""

from __future__ import annotations

from typing import Callable

DEFAULT = "birefnet-lite-matting"


def _birefnet(weights: str, res: int, stride: int = 2, name: str = "") -> Callable[[], object]:
    def make():
        from .birefnet import BiRefNetMatte

        m = BiRefNetMatte(weights, res=res, stride=stride)
        m.kind = name or weights
        return m

    return make


def _mediapipe():
    from .selfie import SelfieMatte

    return SelfieMatte()


KINDS: dict[str, Callable[[], object]] = {
    # the default: soft hair edges, lowest flicker of the candidates that fit the chunk budget
    "birefnet-lite-matting": _birefnet("birefnet-lite-matting", 384),
    # the same net at 320: 17-27% less GPU time for a slightly softer edge (budget fallback)
    "birefnet-lite-matting-fast": _birefnet("birefnet-lite-matting", 320,
                                            name="birefnet-lite-matting-fast"),
    "birefnet-lite": _birefnet("birefnet-lite", 384),          # general DIS weights, harder edge
    "mediapipe": _mediapipe,                                    # CPU, coarse: halos, 2-4x flicker
    "birefnet": _birefnet("birefnet", 384),                     # Swin-L: over budget, A/B only
}
