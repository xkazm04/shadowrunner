"""Procedural head motion: a per-frame 2D similarity transform on top of FlashHead.

FlashHead Lite barely moves the head: in speech its rigid shift is under 1 px and its roll range
0.8 degrees at 512 px (docs/talking-head.md "Round 3"). `Motion` adds, per frame (dx, dy in px at the
model size, rot in degrees, scale), applied to the HEAD only (th/live/headlayer.py, round 4: round 3
moved the whole frame and read as camera shake):
- sway: smoothed noise, a sum of three sines per axis at 0.1-0.3 Hz with seeded phases; in idle at
  IDLE_GAIN and IDLE_SLOW (the owner approved that idle), in speech slightly larger and quicker
  (SPEECH_GAIN, SPEECH_SLOW);
- nods: on energy onsets of the speech audio (a rise of ONSET_DB over the last 0.2 s while voiced),
  then none for a random 2-3 s (REFRACTORY_S, so they never tick at a fixed rate); a short, soft
  down-and-back bump in dy with a slight scale-down;
- tilts: at sentence ends. The engine passes each sentence's first sample; the next sentence's
  start marks where the one before ended, and the tilt eases in (smoothstep, TILT_S) from that
  sentence's last voiced frame to a new roll target with a small sideways lean. A line's last
  sentence, and the mic, which has no marks: a pause of END_PAUSE_S after at least END_RUN_S of
  voice (Kokoro's sentence pauses are 0.5-0.6 s, its comma pauses 0.3-0.36 s);
- idle: no nods, and a small new tilt every 5-9 s.
Levels: `plain` (identity; the owner's default since round 5: plain FlashHead), `off` (identity), `natural` (gain 1), `lively` (gain 1.6); a level change eases over 0.5 s.
Everything is a function of the frames fed so far and the seed: the same feed gives the same
transforms, however it is split into chunks.
"""

from __future__ import annotations

import math

import numpy as np

LEVELS = ("plain", "off", "natural", "lively")
GAIN = {"plain": 0.0, "off": 0.0, "natural": 1.0, "lively": 1.6}
FPS = 25
RATE = 16000
HOP = RATE // FPS  # audio samples per frame
SWAY_PX = (2.6, 1.6)  # dx, dy amplitude (sum of sines, so peaks reach about 1.5x)
SWAY_DEG = 0.7
SWAY_HZ = (0.1, 0.3)
IDLE_GAIN = 0.45  # sway while quiet (round 3's approved idle)
IDLE_SLOW = 0.6  # idle sway frequency factor
SPEECH_GAIN = 0.6  # sway while talking: a little more than idle (round 3: 1.0, read as shake)
SPEECH_SLOW = 0.75
NOD_PX = 2.4
NOD_SCALE = -0.003
NOD_S = (0.16, 0.36)  # down, back
REFRACTORY_S = (2.0, 3.0)  # after a nod, the next waits this long (uniform)
ONSET_DB = 9.0
VOICED_DB = -38.0  # dBFS of a frame's RMS
TILT_DEG = (0.6, 1.5)
TILT_PX = 1.0  # sideways lean per degree of tilt
TILT_S = 0.7
TILT_GAP_S = 1.2  # a sentence-end tilt needs this long since the last tilt
END_PAUSE_S, END_RUN_S = 0.44, 1.5  # unmarked sentence ends: a pause after a run of voice
IDLE_TILT_S = (5.0, 9.0)
ATTACK_S, RELEASE_S = 0.25, 1.2
LEVEL_EASE_S = 0.5
CHUNK = 24  # frames per engine chunk
LOOKBACK = 30  # frames: how far back a sentence start looks for the previous sentence's voice


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class Motion:
    def __init__(self, level: str = "plain", seed: int = 1116) -> None:
        assert level in LEVELS, level
        self.level = level
        self.rng = np.random.default_rng(seed)
        r = self.rng
        # sway: per axis (dx, dy, rot) three sines, frequency in SWAY_HZ, seeded phase and weight
        self._sines = [(r.uniform(*SWAY_HZ, 3), r.uniform(0, 2 * math.pi, 3), r.uniform(0.6, 1.0, 3))
                       for _ in range(3)]
        self.i = 0  # next frame index to feed
        self.params: dict[int, tuple[float, ...]] = {}  # frame -> (dx, dy, rot, scale, level weight)
        self._db: list[float] = []  # recent frame levels, dBFS
        self._act = 0.0  # speech activity 0..1
        self._gain = GAIN[level]
        self._quiet = 10**9  # frames since the last voiced frame
        self._run = 0  # frames of the current run of speech (pauses under END_PAUSE_S included)
        self._voiced: dict[int, bool] = {}  # recent frames: voiced or not (sentence-end lookback)
        self._last_nod = -10**9
        self._nod_gap = REFRACTORY_S[0] * FPS
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
        start where a sentence's first sample sits. A sentence start after voice marks the end of
        the sentence before it: its tilt starts after that sentence's last voiced frame (within this
        chunk of CHUNK frames, so the result does not depend on how the feed is split). Frames
        already fed are skipped; a gap (a skipped chunk) is filled with silence."""
        n = len(audio16k) // HOP
        while self.i < first:
            self._voiced[self.i] = False
            self._frame(self.i, -120.0, False)
        dbs = []
        for j in range(n):
            seg = audio16k[j * HOP:(j + 1) * HOP]
            rms = float(np.sqrt(np.mean(np.square(seg, dtype=np.float64)))) if len(seg) else 0.0
            dbs.append(20 * math.log10(max(rms, 1e-6)))
            self._voiced.setdefault(first + j, dbs[-1] > VOICED_DB)
        ends = set()
        for fs in {first + int(ms // 40) for ms in sentences}:
            v = next((k for k in range(fs - 1, fs - LOOKBACK - 1, -1) if self._voiced.get(k)), None)
            if v is not None:  # not a line's first sentence
                ends.add(max(v + 1, fs - fs % CHUNK, first))
        for j in range(n):
            if first + j >= self.i:
                self._frame(first + j, dbs[j], first + j in ends)
        self._prune()

    def get(self, first: int, n: int) -> np.ndarray:
        """(n, 5) float32 (dx, dy, rot, scale, level weight) for frames first..first+n-1; identity
        where unknown. The level weight (0..1) is the eased level gain, capped at 1."""
        ident = (0.0, 0.0, 0.0, 1.0, 0.0)
        return np.array([self.params.get(first + j, ident) for j in range(n)], np.float32)

    def idle(self, first: int, n: int) -> bool:
        """Whether these frames are exactly the identity (level off and eased out): skip the warp."""
        return bool(np.all(self.get(first, n) == np.array([0, 0, 0, 1, 0], np.float32)))

    def _prune(self) -> None:
        old = self.i - 10 * FPS  # the engine reads back at most HOLD frames
        for k in [k for k in self.params if k < old]:
            del self.params[k]
        for k in [k for k in self._voiced if k < self.i - 2 * LOOKBACK]:
            del self._voiced[k]

    def _frame(self, i: int, db: float, end: bool) -> None:
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
        if voiced and rise > ONSET_DB and i - self._last_nod >= self._nod_gap:
            self._last_nod = i
            self._nod_gap = r.uniform(*REFRACTORY_S) * FPS
            self._nods.append((i, float(r.uniform(0.6, 1.0)) * min(1.0, rise / (2 * ONSET_DB) + 0.5)))
            self._event(i, "nod")
        # tilts: a sentence end (marked by the engine's next sentence, or a long pause after a run
        # of voice: a line's last sentence, the mic)
        pause = (not voiced and self._quiet + 1 == round(END_PAUSE_S * FPS) and self._run >= END_RUN_S * FPS)
        if (end or pause) and i - self._last_tilt >= TILT_GAP_S * FPS:
            self._last_tilt = i
            self._new_tilt(i, 1.0)
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
        self._run = self._run + 1 if self._quiet < END_PAUSE_S * FPS else 0
        self.params[i] = self._compose(i)
        self.i = i + 1

    def _event(self, i: int, kind: str) -> None:
        if self.level not in ("off", "plain"):  # computed either way (the state stays continuous), shown only on
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
        amp = IDLE_GAIN + (SPEECH_GAIN - IDLE_GAIN) * act
        slow = IDLE_SLOW + (SPEECH_SLOW - IDLE_SLOW) * act
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
