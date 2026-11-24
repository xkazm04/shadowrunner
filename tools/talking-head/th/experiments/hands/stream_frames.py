"""Host-memory discipline for the EchoMimicV3 drivers (spec iris-hands round 3): a long take is never
held as one float32 clip. Copied into the clone next to the drivers (th_stream_frames.py) and
imported by them there; pure numpy (plus whatever array type the caller passes), so `th` tests it.

- `Stitcher` joins windows the way the round-2 driver did (the last `overlap` frames of window k
  crossfaded with the first `overlap` of window k+1, r = linspace(0, 1, overlap)) but yields the
  finished frames as it goes and keeps only the pending tail: the same arithmetic, element for
  element, without the whole-clip buffer or the copy `torch.cat` made at every join.
- `to_uint8` is upstream save_videos_grid's conversion ((x * 255) cast to uint8, truncating).
- `FrameWriter` writes frames one at a time with upstream's colour transfer (every frame after the
  first matched to the first frame's LAB mean/std) instead of building every frame as a PIL image.
"""

from __future__ import annotations

from typing import Any, Callable, Iterator

import numpy as np


def to_uint8(frame_f32: np.ndarray) -> np.ndarray:
    """(H, W, 3) float in [0, 1] -> uint8, as upstream: `(x * 255).numpy().astype(np.uint8)`."""
    return (np.asarray(frame_f32, dtype=np.float32) * np.float32(255)).astype(np.uint8)


def ramp(overlap: int, like: Any = None):
    """The crossfade weights, linspace(0, 1, overlap), in float32 (torch's and numpy's agree)."""
    r = np.linspace(0, 1, overlap, dtype=np.float32)
    return r if like is None else like


class Stitcher:
    """Frames along axis 0. push(window) yields the frames that are final; finish() the rest.
    `blend(a, b)` is a * (1 - r) + b * r along axis 0; the default works for numpy arrays."""

    def __init__(self, overlap: int, blend: Callable[[Any, Any], Any] | None = None):
        self.overlap = overlap
        self.pending = None   # the last `overlap` frames of the previous window, not yet written
        self._blend = blend or self._np_blend

    def _np_blend(self, a, b):
        r = ramp(self.overlap).reshape((-1,) + (1,) * (a.ndim - 1))
        return a * (1 - r) + b * r

    def push(self, window) -> Iterator[Any]:
        ov = self.overlap
        if len(window) < 2 * ov:
            raise ValueError("a window must be at least twice the overlap")
        if self.pending is None:
            head = window[:len(window) - ov]
        else:
            yield from self._blend(self.pending, window[:ov])
            head = window[ov:len(window) - ov]
        yield from head
        self.pending = window[len(window) - ov:]

    def tail(self):
        """The motion frames for the next window (the current window's last `overlap` frames)."""
        return self.pending

    def finish(self) -> Iterator[Any]:
        if self.pending is not None:
            yield from self.pending
            self.pending = None


class FrameWriter:
    """uint8 frames in, one at a time; colour transfer against the first frame as upstream."""

    def __init__(self, open_writer: Callable[[], Any], color_transfer: Callable | None = None):
        self._open, self._ct = open_writer, color_transfer
        self.writer, self.first, self.count = None, None, 0

    def append(self, frame_u8: np.ndarray) -> None:
        if self.writer is None:
            self.writer = self._open()
        if self.first is None:
            self.first = frame_u8
            out = frame_u8
        else:
            out = self._ct(frame_u8, self.first) if self._ct else frame_u8
        self.writer.append_data(np.asarray(out))
        self.count += 1

    def close(self) -> int:
        if self.writer is not None:
            self.writer.close()
        return self.count
