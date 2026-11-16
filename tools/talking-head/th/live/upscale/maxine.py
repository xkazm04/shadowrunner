"""NVIDIA Maxine / RTX Video super resolution (task 2). Stub until task 2 replaces this module."""

from __future__ import annotations


class MaxineUpscaler:
    kind = "maxine"
    scale = 2

    def warmup(self) -> None:
        raise NotImplementedError("maxine: task 2")

    def __call__(self, frames):  # noqa: ANN001 - see the Upscaler protocol
        raise NotImplementedError("maxine: task 2")
