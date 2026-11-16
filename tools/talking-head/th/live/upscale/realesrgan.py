"""Real-ESRGAN compact 2x (task 2). Stub until task 2 replaces this module."""

from __future__ import annotations


class RealEsrganUpscaler:
    kind = "realesrgan"
    scale = 2

    def warmup(self) -> None:
        raise NotImplementedError("realesrgan: task 2")

    def __call__(self, frames):  # noqa: ANN001 - see the Upscaler protocol
        raise NotImplementedError("realesrgan: task 2")
