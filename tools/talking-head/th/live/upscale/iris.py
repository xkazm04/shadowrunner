"""Iris-trained 2x sharpener (round 2). Stub until the sharpener task replaces this module."""

from __future__ import annotations


class IrisUpscaler:
    kind = "iris"
    scale = 2

    def warmup(self) -> None:
        raise NotImplementedError("iris: round 2 sharpener task")

    def __call__(self, frames):  # noqa: ANN001 - see the Upscaler protocol
        raise NotImplementedError("iris: round 2 sharpener task")
