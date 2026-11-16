"""The upscaler and matte stages of the live engine (a mixin of `Engine`): loading and warming
them off the GPU thread, swapping them in at a chunk boundary, and running them on a chunk with a
fallback (an upscaler that fails falls back to `none`, a matte that fails switches matting off; each
says why once in an `error` event, the stream never stops).
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import numpy as np

from . import protocol as P
from .compose import upscale_alpha
from .matte.kinds import DEFAULT as _MATTE_DEFAULT  # the registry imports lazily: cheap
from .upscale import Upscaler, get_upscaler

MATTE_KIND = os.environ.get("TH_LIVE_MATTE") or _MATTE_DEFAULT
LOOKAHEAD_FLOOR_MS = 750.0
LOOKAHEAD_MARGIN_MS = 150.0  # JPEG encoding and the hand-off, on top of the GPU time
LOOKAHEAD_WINDOW = 8  # chunks


class Stages:
    """Needs from the engine: sink, now_ms, _lock, stats, upscaler, matte, _pending_up, _pending_matte,
    post, model, ready."""

    def set_upscale(self, kind: str) -> None:
        """Load and warm the upscaler off the GPU thread; it takes over at the next chunk."""
        def load() -> None:
            up = self._load_upscaler(kind)
            if up is not None:
                with self._lock:
                    self._pending_up = up

        threading.Thread(target=load, name=f"upscale-{kind}", daemon=True).start()

    def set_matte(self, on: bool) -> None:
        """Matting on (the TH_LIVE_MATTE kind, loaded and warmed off the GPU thread) or off, from
        the next chunk. A kind that cannot load sends one `error` event and matting stays off."""
        def load() -> None:
            m = self._load_matte()
            if m is not None:
                with self._lock:
                    self._pending_matte = m

        if on:
            threading.Thread(target=load, name="matte", daemon=True).start()
        else:
            with self._lock:
                self._pending_matte = False

    def _error(self, text: str) -> None:
        self.sink("event", P.event("error", max(0.0, self.now_ms()), None, text))

    def _load_upscaler(self, kind: str) -> Upscaler | None:
        """The warmed upscaler, or None plus one `error` event naming the reason (unknown kind,
        weights not fetched, SDK failure); the stream carries on with the current one."""
        try:
            up = get_upscaler(kind)
            up.warmup()
            return up
        except Exception as e:
            self._error(f"upscale {kind}: {e}")
            return None

    def _load_matte(self) -> Any:
        try:
            from .matte import get_matte

            m = get_matte(MATTE_KIND)
            m.warmup()
            self._warm_first_chunk(m)
            return m
        except Exception as e:
            self._error(f"matte {MATTE_KIND}: {e}")
            return None

    def lookahead(self) -> float:
        """How long before its pts an idle chunk starts computing. TH_LIVE_LOOKAHEAD_MS fixes it;
        otherwise it adapts: the lead its first frame needs (HOLD frames with the seam blend, plus
        the slowest of the last LOOKAHEAD_WINDOW chunks, plus a margin), between 750 and 960 ms.
        Lower means a cold line is heard sooner (by up to 960 minus this); never so low that a
        chunk is late. Matting or a slower co-tenant raises it within a chunk."""
        from .compose import HOLD
        from .engine import LATEST_MS, LOOKAHEAD_AUTO

        recent = self.stats["chunkMs"][-LOOKAHEAD_WINDOW:]
        if not LOOKAHEAD_AUTO or len(recent) < 3:
            return LATEST_MS
        need = (HOLD * 40.0 if self.post.blend else 0.0) + max(recent) + LOOKAHEAD_MARGIN_MS
        return min(LATEST_MS, max(LOOKAHEAD_FLOOR_MS, need))

    def _warm_first_chunk(self, m: Any) -> None:
        """The first chunk of a stream is HOLD frames short (the seam blend holds them back): run
        that shape once too, so cuDNN's per-shape autotuning (1 s for BiRefNet) is not paid live."""
        from .compose import HOLD, SLICE_FRAMES

        if not self.post.blend or self.ready:
            return
        try:
            import torch

            if not torch.cuda.is_available():
                return
            size = self.model.size
            m(torch.zeros((SLICE_FRAMES - HOLD, size, size, 3), dtype=torch.uint8, device="cuda"))
            torch.cuda.synchronize()
            reset = getattr(m, "reset", None)
            if reset is not None:
                reset()
        except Exception:  # a shape warm-up is best effort; the real call reports real errors
            return

    def _swap_upscaler(self, up: Upscaler) -> None:
        old, self.upscaler = self.upscaler, up
        close = getattr(old, "close", None)  # e.g. Maxine frees its SDK handles
        if close is not None and old is not up:
            close()
        self.sink("state", None)

    def _apply_pending(self) -> None:
        with self._lock:
            up, self._pending_up = self._pending_up, None
            m, self._pending_matte = self._pending_matte, None
        if up is not None:
            self._swap_upscaler(up)
        if m is not None:
            self.matte = m or None
            self.sink("state", None)

    def _matte_frames(self, frames: Any) -> Any:
        t1 = time.perf_counter()
        try:
            alpha = self.matte(frames)
            if not isinstance(alpha, np.ndarray):
                import torch

                torch.cuda.synchronize()
            self.stats["matteMs"].append((time.perf_counter() - t1) * 1000)
            return alpha
        except Exception as e:  # never crash the stream: matting off, say why once
            self._error(f"matte {getattr(self.matte, 'kind', '?')} failed, matting off: {e}")
            self.matte = None
            self.sink("state", None)
            return None

    def _upscale(self, frames: Any, alpha: Any) -> tuple[Any, Any, float | None]:
        if self.upscaler.kind == "none":
            return frames, alpha, None
        import torch

        torch.cuda.synchronize()
        t1 = time.perf_counter()
        try:
            frames = self.upscaler(frames)
            if alpha is not None:
                alpha = upscale_alpha(alpha, self.upscaler.scale)
            torch.cuda.synchronize()
            up_ms = (time.perf_counter() - t1) * 1000
            self.stats["upscaleMs"].append(up_ms)
            return frames, alpha, up_ms
        except Exception as e:  # never crash the stream: fall back to none, say why once
            self._error(f"upscale {self.upscaler.kind} failed, using none: {e}")
            self._swap_upscaler(get_upscaler("none"))
            return frames, None, None
