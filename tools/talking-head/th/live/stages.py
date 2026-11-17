"""The upscaler and matte stages of the live engine (a mixin of `Engine`): loading and warming
them off the GPU thread, swapping them in at a chunk boundary, and running them on a chunk with a
fallback (an upscaler that fails falls back to `none`, a matte that fails switches matting off; each
says why once in an `error` event, the stream never stops). Round 3 adds the gaze glance switch
(th/live/gaze.py) before FlashHead and the head motion (th/live/motion.py) after the matte; round 4
applies that motion to the head only (th/live/headlayer.py).
"""

from __future__ import annotations

import os
import sys
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
DISSOLVE = 6  # frames, at a gaze switch in a silent chunk


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

    # ---- round 3: head motion and gaze glances ----------------------------------------------------

    def _init_motion(self, level: str, seed: int) -> None:
        from .gaze import GazePolicy
        from .motion import Motion

        self.motion_level = level
        self.motion = Motion(level, seed)
        self.gaze = GazePolicy(level, seed, available=getattr(self.model, "refs", {}).keys())
        self._glances: list[tuple[float, float]] = []  # pts windows where an idle glance shows live
        self._switched = False  # this chunk's reference differs from the previous chunk's
        self.head: Any = None  # a HeadLayer once built; until then (about 1 s) nothing moves
        threading.Thread(target=self._build_head, name="headlayer-load", daemon=True).start()

    def _build_head(self) -> None:
        """The head map from the model's reference (MediaPipe multiclass segmenter), or, for a model
        without one (the fake), a geometric stand-in. A segmenter that cannot load says so once and
        falls back to the stand-in."""
        from .headlayer import HeadLayer

        size = self.model.size
        portrait = getattr(self.model, "portrait", None)
        try:
            self.head = HeadLayer.from_image(portrait, size) if portrait else HeadLayer.geometric(size)
        except Exception as e:
            self._error(f"head layer: {e}; using a geometric head mask")
            self.head = HeadLayer.geometric(size)

    def set_motion(self, level: str) -> None:
        """Head motion and glances at `level` from the next chunk (motion eases over 0.5 s)."""
        with self._lock:
            self.motion_level = level
            self.motion.set_level(level)
            self.gaze.set_level(level)
        self.sink("state", None)

    def _glance_live(self, pts: float) -> bool:
        return any(a <= pts <= b for a, b in self._glances)

    def _gaze_turn(self, k: int, sentences: int, speaking: bool) -> str:
        """Pick chunk k's reference and switch the model to it (keeping its motion latents)."""
        from .compose import FADE, SLICE_FRAMES

        prev = getattr(self.model, "reference", "main")
        ref = self.gaze.decide(k, sentences, speaking)
        set_ref = getattr(self.model, "set_reference", None)
        if set_ref is None or (ref != "main" and ref not in getattr(self.model, "refs", {})):
            ref = "main"
        if set_ref is not None and ref != prev:
            set_ref(ref)
            if ref != "main":  # the review notes point at these (stream pts of the glance chunk)
                print(f"th live: glance {ref} at {k * SLICE_FRAMES * 40.0:.0f} ms "
                      f"({'speech' if speaking else 'idle'})", file=sys.stderr, flush=True)
        self._switched = ref != prev
        nxt = self.gaze.planned
        if nxt is not None:  # an idle glance next chunk: show the live model over the loop for it
            a = (nxt[0] * SLICE_FRAMES - FADE) * 40.0
            self._glances.append((a, a + (SLICE_FRAMES + 2 * FADE) * 40.0))
        self._glances = [w for w in self._glances if w[1] > (k - 2) * SLICE_FRAMES * 40.0]
        return ref

    def _dissolve(self, frames: Any, first: int, k: int) -> Any:
        """At a reference switch in a silent chunk, dissolve the first DISSOLVE new frames from the
        last held frame (the probe: entry step 1.84 -> 1.2 against a 0.77 median). Not in speech: it
        froze the lips and did not lower the step there."""
        from .compose import SLICE_FRAMES, mix

        pos = k * SLICE_FRAMES - first  # index of the chunk's first new frame in `frames`
        if pos < 1 or len(frames) < pos + DISSOLVE:
            return frames
        n = DISSOLVE
        anchor = frames[pos - 1:pos]
        held = anchor.repeat(n, 0) if isinstance(frames, np.ndarray) else anchor.expand(n, -1, -1, -1)
        out = frames.copy() if isinstance(frames, np.ndarray) else frames.clone()
        out[pos:pos + n] = mix(held, frames[pos:pos + n], [(j + 1) / (n + 1) for j in range(n)])
        return out

    def _move(self, first: int, frames: Any, alpha: Any) -> tuple[Any, Any]:
        """Head motion on the composed 512 frames (and the alpha), before the upscaler: the head
        moves, the body and the backdrop stay still (th/live/headlayer.py). One frame per chunk
        refreshes the head map off this thread."""
        n = len(frames)
        head = self.head
        if head is None or self.motion.idle(first, n) or head.size != frames.shape[1]:
            return frames, alpha
        t1 = time.perf_counter()
        mid = frames[n // 2]
        head.observe(mid if isinstance(mid, np.ndarray) else mid.cpu().numpy())
        params = self.motion.get(first, n)
        frames, alpha = head.apply(frames, params, alpha)
        if not isinstance(frames, np.ndarray):
            import torch

            torch.cuda.synchronize()
        self.stats["motionMs"].append((time.perf_counter() - t1) * 1000)
        self.stats["motion"] += [[first + j, *(round(float(v), 4) for v in row)] for j, row in enumerate(params)]
        return frames, alpha


def jpeg_frame(frame: np.ndarray) -> bytes:
    from PIL import Image

    bio = __import__("io").BytesIO()
    Image.fromarray(frame).save(bio, "JPEG", quality=P.JPEG_QUALITY)
    return bio.getvalue()


def jpeg_pair(frame: np.ndarray, alpha: np.ndarray) -> tuple[bytes, bytes]:
    """Colour JPEG plus the alpha as a greyscale JPEG (0x04)."""
    return jpeg_frame(frame), jpeg_frame(alpha)
