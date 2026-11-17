"""Procedural head motion (round 3): a per-frame 2D similarity transform on top of FlashHead.

FlashHead Lite barely moves the head: in speech its rigid shift is under 1 px and its roll range
0.8 degrees at 512 px (docs/talking-head.md "Round 3"). `Motion` adds, per frame (dx, dy in px at the
model size, rot in degrees, scale):
- sway: smoothed noise, a sum of three sines per axis at 0.1-0.3 Hz with seeded phases;
- nods: on energy onsets of the speech audio (a rise of ONSET_DB over the last 0.2 s while voiced),
  at most one per REFRACTORY_S; a short down-and-back bump in dy with a slight scale-down;
- tilts: at sentence starts (the engine passes each sentence's first sample) and clause pauses
  (voice resuming after PAUSE_S of quiet), an eased (smoothstep, TILT_S) move to a new roll target
  with a small sideways lean;
- idle: when the audio is quiet the sway slows and shrinks (IDLE_GAIN) and a small new tilt comes
  every 5-9 s; no nods.
Levels: `off` (identity), `natural` (gain 1), `lively` (gain 1.6); a level change eases over 0.5 s.
Everything is a function of the frames fed so far and the seed: the same feed gives the same
transforms, however it is split into chunks.

`warp` applies the transforms with one bilinear affine grid sample (torch, on the frames' device),
to the frames and, when matting is on, to the alpha with the same grid. Rotation and scale pivot
on the neck (PIVOT). Without a matte the frame is zoomed by ZOOM and each transform is shrunk toward
the pure zoom just enough that every output pixel samples inside the source (`fit`), so no border
ever shows; with a matte nothing is zoomed and the edges are clamped.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

LEVELS = ("off", "natural", "lively")
GAIN = {"off": 0.0, "natural": 1.0, "lively": 1.6}
FPS = 25
RATE = 16000
HOP = RATE // FPS  # audio samples per frame
ZOOM = 1.04  # without a matte
PIVOT = (0.5, 0.72)  # the neck, as a fraction of (width, height)
SIZE_REF = 512.0  # amplitudes are in px at this size and scale with the frame
SWAY_PX = (2.6, 1.6)  # dx, dy amplitude (sum of sines, so peaks reach about 1.5x)
SWAY_DEG = 0.7
SWAY_HZ = (0.1, 0.3)
IDLE_GAIN = 0.45  # sway and tilts while quiet
IDLE_SLOW = 0.6  # idle sway frequency factor
NOD_PX = 3.4
NOD_SCALE = -0.004
NOD_S = (0.14, 0.32)  # down, back
REFRACTORY_S = 0.8
ONSET_DB = 9.0
VOICED_DB = -38.0  # dBFS of a frame's RMS
PAUSE_S = 0.16
TILT_DEG = (0.6, 1.5)
TILT_PX = 1.4  # sideways lean per degree of tilt
TILT_S = 0.7
IDLE_TILT_S = (5.0, 9.0)
ATTACK_S, RELEASE_S = 0.25, 1.2
LEVEL_EASE_S = 0.5
CLAUSE_GAP_S = 1.5  # a clause tilt needs this long since the last tilt


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Motion:
    def __init__(self, level: str = "natural", seed: int = 1116) -> None:
        assert level in LEVELS, level
        self.level = level
        self.rng = np.random.default_rng(seed)
        r = self.rng
        # sway: per axis (dx, dy, rot) three sines, frequency in SWAY_HZ, seeded phase and weight
        self._sines = [(r.uniform(*SWAY_HZ, 3), r.uniform(0, 2 * math.pi, 3), r.uniform(0.6, 1.0, 3))
                       for _ in range(3)]
        self.i = 0  # next frame index to feed
        self.params: dict[int, tuple[float, ...]] = {}  # frame -> (dx, dy, rot, scale, zoom weight)
        self._db: list[float] = []  # recent frame levels, dBFS
        self._act = 0.0  # speech activity 0..1
        self._gain = GAIN[level]
        self._quiet = 10**9  # frames since the last voiced frame
        self._last_nod = -10**9
        self._nods: list[tuple[int, float]] = []  # (start frame, strength)
        self._tilt = (0.0, 0.0, 0, 1)  # (from deg, to deg, start frame, duration frames)
        self._next_idle_tilt = None  # frame index
        self._last_tilt = -10**9
        self.events: list[tuple[int, str]] = []  # (frame, "nod" | "tilt" | "idle-tilt"), level not off

    def set_level(self, level: str) -> None:
        assert level in LEVELS, level
        self.level = level

    # ---- feeding -------------------------------------------------------------------------------

    def feed(self, first: int, audio16k: np.ndarray, sentences: list[float] = ()) -> None:
        """Audio for frames first.. (HOP samples each); `sentences`: offsets in ms from `first`'s
        start where a sentence's first sample sits. Frames already fed are skipped; a gap (a
        skipped chunk) is filled with silence."""
        n = len(audio16k) // HOP
        starts = {first + int(ms // 40) for ms in sentences}
        while self.i < first:
            self._frame(self.i, -120.0, False)
        for j in range(n):
            idx = first + j
            if idx < self.i:
                continue
            seg = audio16k[j * HOP:(j + 1) * HOP]
            rms = float(np.sqrt(np.mean(np.square(seg, dtype=np.float64)))) if len(seg) else 0.0
            self._frame(idx, 20 * math.log10(max(rms, 1e-6)), idx in starts)
        self._prune()

    def get(self, first: int, n: int) -> np.ndarray:
        """(n, 5) float32 (dx, dy, rot, scale, zoom weight) for frames first..first+n-1; identity
        where unknown. The zoom weight (0..1) eases the no-border zoom in and out with the level."""
        ident = (0.0, 0.0, 0.0, 1.0, 0.0)
        return np.array([self.params.get(first + j, ident) for j in range(n)], np.float32)

    def idle(self, first: int, n: int) -> bool:
        """Whether these frames are exactly the identity (level off and eased out): skip the warp."""
        return bool(np.all(self.get(first, n) == np.array([0, 0, 0, 1, 0], np.float32)))

    def _prune(self) -> None:
        old = self.i - 10 * FPS  # the engine reads back at most HOLD frames
        for k in [k for k in self.params if k < old]:
            del self.params[k]

    def _frame(self, i: int, db: float, sentence: bool) -> None:
        r = self.rng
        self._db = (self._db + [db])[-6:]
        voiced = db > VOICED_DB
        a_target = 1.0 if voiced else 0.0
        rate = 1 / (ATTACK_S * FPS) if a_target > self._act else 1 / (RELEASE_S * FPS)
        self._act += max(-rate, min(rate, a_target - self._act))
        g_target = GAIN[self.level]
        step = GAIN["lively"] / (LEVEL_EASE_S * FPS)
        self._gain += max(-step, min(step, g_target - self._gain))
        # nods: an onset while voiced, outside the refractory period
        rise = db - min(self._db[:-1]) if len(self._db) > 1 else 0.0
        if voiced and rise > ONSET_DB and i - self._last_nod >= REFRACTORY_S * FPS:
            self._last_nod = i
            self._nods.append((i, float(r.uniform(0.6, 1.0)) * min(1.0, rise / (2 * ONSET_DB) + 0.5)))
            self._event(i, "nod")
        # tilts: a sentence start, or voice resuming after a pause (a clause)
        clause = (voiced and PAUSE_S * FPS <= self._quiet < 2 * FPS
                  and i - self._last_tilt >= CLAUSE_GAP_S * FPS)
        if sentence or clause:
            self._last_tilt = i
            self._new_tilt(i, 1.0 if sentence else 0.6)
            self._event(i, "tilt")
            self._next_idle_tilt = None
        elif self._act < 0.05:
            if self._next_idle_tilt is None:
                self._next_idle_tilt = i + int(r.uniform(*IDLE_TILT_S) * FPS)
            elif i >= self._next_idle_tilt:
                self._new_tilt(i, IDLE_GAIN)
                self._event(i, "idle-tilt")
                self._next_idle_tilt = i + int(r.uniform(*IDLE_TILT_S) * FPS)
        self._quiet = 0 if voiced else self._quiet + 1
        self.params[i] = self._compose(i)
        self.i = i + 1

    def _event(self, i: int, kind: str) -> None:
        if self.level != "off":  # computed either way (the state stays continuous), shown only on
            self.events.append((i, kind))

    def _new_tilt(self, i: int, amount: float) -> None:
        cur = self._tilt_at(i)
        mag = float(self.rng.uniform(*TILT_DEG)) * amount
        sign = -1.0 if cur > 0 else 1.0  # lean the other way more often than not
        if self.rng.random() < 0.3:
            sign = -sign
        self._tilt = (cur, sign * mag, i, int(TILT_S * FPS))

    def _tilt_at(self, i: int) -> float:
        a, b, s, d = self._tilt
        return a + (b - a) * _smooth((i - s) / d)

    def _compose(self, i: int) -> tuple[float, float, float, float]:
        t = i / FPS
        act = self._act
        amp = IDLE_GAIN + (1 - IDLE_GAIN) * act
        slow = IDLE_SLOW + (1 - IDLE_SLOW) * act
        sw = [sum(w * math.sin(2 * math.pi * f * slow * t + p) for f, p, w in zip(*axis)) / 1.6
              for axis in self._sines]
        dx = SWAY_PX[0] * sw[0] * amp
        dy = SWAY_PX[1] * sw[1] * amp
        rot = SWAY_DEG * sw[2] * amp
        scale = 1.0
        for s0, k in self._nods:
            dt = (i - s0) / FPS
            if dt < NOD_S[0]:
                b = math.sin(0.5 * math.pi * dt / NOD_S[0])
            elif dt < NOD_S[0] + NOD_S[1]:
                b = 0.5 + 0.5 * math.cos(math.pi * (dt - NOD_S[0]) / NOD_S[1])
            else:
                continue
            dy += NOD_PX * k * b
            scale += NOD_SCALE * k * b
        self._nods = [(s0, k) for s0, k in self._nods if (i - s0) / FPS < sum(NOD_S)]
        tilt = self._tilt_at(i)
        rot += tilt
        dx += TILT_PX * tilt
        g = self._gain
        return (dx * g, dy * g, rot * g, 1.0 + (scale - 1.0) * g, min(1.0, g))


# ---- applying it ----------------------------------------------------------------------------------


def _inverse_theta(p: np.ndarray, w: int, h: int, zoom: float) -> np.ndarray:
    """(N, 2, 3) affine_grid thetas (output -> input, normalised coords, align_corners=False).
    p: (N, 5); a frame's zoom is 1 + (zoom - 1) * its zoom weight."""
    k = min(w, h) / SIZE_REF
    out = np.zeros((len(p), 2, 3), np.float64)
    cx, cy = PIVOT[0] * w, PIVOT[1] * h
    for j, (dx, dy, rot, s, zw) in enumerate(p.astype(np.float64)):
        a = math.radians(rot)
        m = s * (1 + (zoom - 1) * zw) * np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        mi = np.linalg.inv(m)
        c = np.array([cx, cy])
        t = np.array([dx, dy]) * k
        # u_in = c + mi (u_out - c - t), u in pixels (continuous); n = 2u/size - 1
        lin = mi
        off = c - mi @ (c + t)
        d = np.diag([w / 2, h / 2])
        di = np.diag([2 / w, 2 / h])
        out[j, :, :2] = di @ lin @ d
        out[j, :, 2] = di @ (lin @ np.array([w / 2, h / 2]) + off) - 1
    return out


def fit(p: np.ndarray, w: int, h: int, zoom: float) -> np.ndarray:
    """Shrink each transform toward the pure zoom until all four output corners sample inside the
    source by at least half a pixel (so bilinear never reads the padding)."""
    p = np.asarray(p, np.float64).copy()
    lim = np.array([1 - 1 / w, 1 - 1 / h])
    corners = np.array([[sx * lim[0], sy * lim[1], 1.0] for sx in (-1, 1) for sy in (-1, 1)])

    def inside(q: np.ndarray) -> bool:
        th = _inverse_theta(q[None], w, h, zoom)[0]
        return bool(np.all(np.abs(corners @ th.T) <= lim + 1e-9))

    for j in range(len(p)):
        if inside(p[j]):
            continue
        base = np.array([0.0, 0.0, 0.0, 1.0, p[j, 4]])
        lo, hi = 0.0, 1.0
        for _ in range(12):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if inside(base + (p[j] - base) * mid) else (lo, mid)
        p[j] = base + (p[j] - base) * lo
    return p.astype(np.float32)


def warp(frames: Any, params: np.ndarray, alpha: Any = None, matte: bool = False) -> tuple[Any, Any, np.ndarray]:
    """Frames (N,H,W,3) uint8 (CUDA tensor or numpy) and optional alpha (N,H,W) -> transformed
    (same types and device), plus the params as applied (after `fit`). Tensors go through torch's
    grid sample; numpy frames (the fake model) through the same sampling in numpy, so the CPU
    path never starts torch's thread pool next to the server's threads."""
    n, h, w = frames.shape[:3]
    zoom = 1.0 if matte else ZOOM
    p = params if matte else fit(params, w, h, zoom)
    theta = _inverse_theta(p, w, h, zoom)
    if isinstance(frames, np.ndarray):
        src = frames.astype(np.float32)
        if alpha is not None:
            src = np.concatenate([src, alpha[..., None].astype(np.float32)], -1)
        out = np.clip(np.rint(_sample_np(src, theta)), 0, 255).astype(np.uint8)
        return out[..., :3].copy(), None if alpha is None else out[..., 3].copy(), p
    import torch
    import torch.nn.functional as F

    x = frames
    th = torch.as_tensor(theta, dtype=torch.float32, device=x.device)  # fp32: fp16 grids jitter
    grid = F.affine_grid(th, [n, 3, h, w], align_corners=False)
    src_t = x.permute(0, 3, 1, 2).float()
    if alpha is not None:
        src_t = torch.cat([src_t, alpha[:, None].float()], 1)
    o = F.grid_sample(src_t, grid, mode="bilinear", padding_mode="border", align_corners=False)
    o = o.round_().clamp_(0, 255).to(torch.uint8)
    rgb = o[:, :3].permute(0, 2, 3, 1).contiguous()
    return rgb, (o[:, 3].contiguous() if alpha is not None else None), p


def _sample_np(src: np.ndarray, theta: np.ndarray) -> np.ndarray:
    """grid_sample(bilinear, padding border, align_corners False) in numpy: (N,H,W,C) float32."""
    n, h, w, c = src.shape
    nx = (2 * (np.arange(w, dtype=np.float32) + 0.5) / w - 1)[None, :]
    ny = (2 * (np.arange(h, dtype=np.float32) + 0.5) / h - 1)[:, None]
    out = np.empty_like(src)
    for i in range(n):
        t = theta[i].astype(np.float32)
        ux = np.clip(((t[0, 0] * nx + t[0, 1] * ny + t[0, 2]) + 1) * (w / 2) - 0.5, 0, w - 1).ravel()
        uy = np.clip(((t[1, 0] * nx + t[1, 1] * ny + t[1, 2]) + 1) * (h / 2) - 0.5, 0, h - 1).ravel()
        x0, y0 = ux.astype(np.int32), uy.astype(np.int32)  # floor: both are >= 0
        x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
        fx, fy = (ux - x0)[:, None], (uy - y0)[:, None]
        f = src[i].reshape(-1, c)
        top = f[y0 * w + x0] * (1 - fx) + f[y0 * w + x1] * fx
        bot = f[y1 * w + x0] * (1 - fx) + f[y1 * w + x1] * fx
        out[i] = (top * (1 - fy) + bot * fy).reshape(h, w, c)
    return out
