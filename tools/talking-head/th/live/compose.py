"""The picture after FlashHead, per chunk, on the GPU thread (round 2): seam blend, idle loop, matte.

Seam blend. FlashHead regenerates its motion context: of the 33 frames `run_pipeline` returns, the
first `motion` (9) decode the latents encoded from the previous output's last 9 frames, so output
frame j < 9 of chunk k+1 covers the instant of new frame 15 + j of chunk k (new = output[9:]). The
last 3 new frames of chunk k (instants 21, 22, 23) therefore have twins in chunk k+1's motion frames
6, 7, 8, decoded jointly with the frames that follow them. We hold those 3 frames, mix each with its
twin at 0.25 / 0.5 / 0.75 (toward the next chunk), and send them with chunk k+1, so the step into
frame 0 of the next chunk is spread over 4 frames. Cost: 3 frames (120 ms) less lead on the first
frame of every chunk. A skipped chunk drops the held frames (they would be out of order and late).

Idle loop. While nothing is spoken the pre-rendered loop (`th live make-idle`) shows; the live model
keeps running on silence underneath. The live weight w ramps by 1/FADE per frame toward 1 from
HOLD frames before a line's first sample, and back toward 0 from TAIL_MS after its end (or always
1 while the source is the mic). When w starts to fall, the loop's phase jumps to the loop frame
nearest the live frame (32 px grey thumbnails), so the fade lands on a similar pose.

Matte. When on, `th.live.matte.get_matte(kind)` gives an alpha per 512 frame; it is upscaled with
the frames' factor (bilinear) and both are JPEG-encoded (`0x04`).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

import numpy as np

HOLD = 3
SEAM_W = (0.25, 0.5, 0.75)
FADE = 6
TAIL_MS = 200.0
THUMB = 32
SLICE_FRAMES = 24


def seam_enabled() -> bool:
    return os.environ.get("TH_LIVE_SEAM", "1") != "0"


def idle_dir(character: str = "iris") -> Path:
    from ..paths import th_home

    return th_home() / "live" / "idle" / character


def load_loop(size: int, path: Path | None = None) -> np.ndarray | None:
    """The idle loop's frames (L, size, size, 3) uint8, or None when it is absent, switched off
    (TH_LIVE_IDLE=0) or rendered at another size."""
    if os.environ.get("TH_LIVE_IDLE", "1") == "0":
        return None
    p = path or idle_dir() / "loop.npz"
    if not p.is_file():
        return None
    frames = np.load(p)["frames"]
    return frames if frames.ndim == 4 and frames.shape[1:3] == (size, size) else None


# ---- numpy / torch helpers (the fake model works in numpy, FlashHead in CUDA tensors) -------------


def _is_np(x: Any) -> bool:
    return isinstance(x, np.ndarray)


def _cat(a: Any, b: Any) -> Any:
    if _is_np(a):
        return np.concatenate([a, b])
    import torch

    return torch.cat([a, b])


def mix(a: Any, b: Any, w: Any) -> Any:
    """Per-frame a*(1-w) + b*w, uint8 out; w is one weight per frame."""
    if _is_np(a):
        wv = np.asarray(w, np.float32)[:, None, None, None]
        return np.rint(a.astype(np.float32) * (1 - wv) + b.astype(np.float32) * wv).astype(np.uint8)
    import torch

    wv = torch.as_tensor(np.asarray(w, np.float32), device=a.device)[:, None, None, None]
    return (a.float() * (1 - wv) + b.float() * wv).round_().clamp_(0, 255).to(torch.uint8)


def _thumbs(x: Any) -> Any:
    f = max(1, x.shape[1] // THUMB)
    t = x[:, ::f, ::f]
    if _is_np(t):
        return t.astype(np.float32).mean(-1).reshape(len(t), -1)
    return t.float().mean(-1).reshape(len(t), -1)


def upscale_alpha(alpha: Any, scale: int) -> Any:
    if scale == 1:
        return alpha
    if _is_np(alpha):
        from PIL import Image

        h, w = alpha.shape[1:3]
        return np.stack([np.asarray(Image.fromarray(a).resize((w * scale, h * scale), Image.BILINEAR))
                         for a in alpha])
    import torch.nn.functional as F

    up = F.interpolate(alpha[:, None].float(), scale_factor=scale, mode="bilinear", align_corners=False)
    return up[:, 0].round_().clamp_(0, 255).to(alpha.dtype)


class Compositor:
    """Seam blend and idle loop over each chunk's frames. `target(pts_ms)` says whether the live
    model should show at that frame."""

    def __init__(self, loop: Any = None, blend: bool | None = None) -> None:
        self.blend = seam_enabled() if blend is None else blend
        self.loop = loop
        self._loop_thumbs = None
        self.held: Any = None
        self.held_k = -2
        self.w = 0.0 if loop is not None else 1.0
        self.phase = 0
        self.stats: dict[str, list] = {"seams": []}

    @property
    def has_loop(self) -> bool:
        return self.loop is not None

    def seam(self, k: int, new: Any, motion: Any) -> tuple[int, Any]:
        """(index of the first frame out, frames out) for chunk k's new frames and its motion frames
        (the previous chunk's last instants, regenerated; None when the model has none)."""
        if not self.blend:
            return k * SLICE_FRAMES, new
        held, hk = self.held, self.held_k
        self.held, self.held_k = new[-HOLD:], k
        body = new[:-HOLD]
        if held is None or hk != k - 1:
            return k * SLICE_FRAMES, body
        blended = motion is not None and len(motion) >= HOLD
        if blended:
            held = mix(held, motion[-HOLD:], SEAM_W)
        self.stats["seams"].append(k)
        return k * SLICE_FRAMES - HOLD, _cat(held, body)

    def compose(self, first: int, frames: Any, target: Callable[[float], bool]) -> tuple[Any, str]:
        """Mix the loop in where the live weight is below 1; returns the frames and which shows at
        the last one ("live" or "loop")."""
        if self.loop is None:
            return frames, "live"
        loop = self._on_device(frames)
        n_loop = len(loop)
        ws: list[float] = []
        idx: list[int] = []
        for i in range(len(frames)):
            w0 = self.w
            self.w = min(1.0, w0 + 1 / FADE) if target((first + i) * 40.0) else max(0.0, w0 - 1 / FADE)
            if w0 >= 1.0 > self.w:  # leaving live: land the loop on the pose nearest this frame
                self.phase = self._nearest(frames[i:i + 1])
            ws.append(self.w)
            idx.append(self.phase % n_loop)
            self.phase += 1
        mode = "live" if ws[-1] >= 0.5 else "loop"
        if min(ws) >= 1.0:
            return frames, mode
        sel = loop[np.asarray(idx)] if _is_np(loop) else loop[idx]
        return mix(sel, frames, ws), mode

    def _on_device(self, like: Any) -> Any:
        if not _is_np(like) and _is_np(self.loop):
            import torch

            self.loop = torch.from_numpy(np.ascontiguousarray(self.loop)).to(like.device)
            self._loop_thumbs = None
        if self._loop_thumbs is None:
            self._loop_thumbs = _thumbs(self.loop)
        return self.loop

    def _nearest(self, frame: Any) -> int:
        d = self._loop_thumbs - _thumbs(frame)
        d = np.abs(d).mean(1) if _is_np(d) else d.abs().mean(1)
        return int(d.argmin())
