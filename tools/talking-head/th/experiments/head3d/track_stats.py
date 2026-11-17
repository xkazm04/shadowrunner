"""A statistical head-rotation track (yaw, pitch, roll in degrees, 25 fps) for a stream of 16 kHz audio.

Matched to natural speech head motion (Busso et al. 2007; the round 5 brief): mostly yaw, with a
speech SD of about 3-5 degrees, pitch and roll smaller, an angular speed of about 10 deg/s, a range
up to about 12-15 degrees, correlated with the voice's energy and pitch (F0), smooth, never periodic.

Built per frame from causal audio features, so it streams: `StatTrack.feed()` takes any split of the
audio and returns the frames it completed; the same audio gives the same track however it is split
(a test checks it). Sources, summed and then low-passed twice (no jitter):
- drift: per axis a band-limited random process (Ornstein-Uhlenbeck noise through two one-pole
  low-passes), scaled by speech activity (idle keeps 40 %);
- turns: on an emphasis (the voice's level jumps over its 1.5 s average while voiced, with F0 above
  the speaker's running mean), at most every 2.5-5 s and with probability 0.6, a slow yaw turn of
  6-10 degrees to a new offset over 0.8-1.2 s (smoothstep), usually back across the centre; offsets
  then relax toward 0 over about 4 s;
- nods: an emphasis onset (5 dB over the average, at most every 1.2-2.6 s) adds a down-and-back
  pitch bump of 1.5-3 degrees over 0.5 s;
- prosody: the head rises a little with F0 (pitch -0.9 deg per SD of log F0, smoothed) and leans
  with yaw (roll +0.15 deg per yaw degree).
Angles are in LivePortrait's convention (checked on renders of Iris): positive pitch tips the chin
down, positive yaw turns the face toward the viewer's left (roll: as its estimator reports it).
"""

from __future__ import annotations

import math

import numpy as np

RATE = 16000
FPS = 25
HOP = RATE // FPS  # 640 samples per frame
WIN = 1024  # F0 window (64 ms)
DT = 1.0 / FPS


def _alpha(tau_s: float) -> float:
    return 1.0 - math.exp(-DT / tau_s)


def frame_features(buf: np.ndarray) -> tuple[float, float | None]:
    """(level dBFS, F0 Hz or None) of the last WIN samples (float32, -1..1)."""
    x = buf[-WIN:].astype(np.float64)
    rms = math.sqrt(float(np.mean(x * x)) + 1e-12)
    db = 20 * math.log10(rms + 1e-9)
    if db < -45:
        return db, None
    x = x - x.mean()
    n = len(x)
    f = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    if ac[0] <= 0:
        return db, None
    ac = ac / ac[0]
    lo, hi = RATE // 400, RATE // 70  # 40..228 samples
    k = lo + int(np.argmax(ac[lo:hi]))
    if ac[k] < 0.45:
        return db, None
    return db, RATE / k


class StatTrack:
    """Streaming track generator; deterministic for (seed, audio)."""

    def __init__(self, seed: int = 1117, scale: float = 1.0) -> None:
        self.rng = np.random.default_rng(seed)
        self.scale = scale
        self.buf = np.zeros(WIN, np.float32)
        self.pending = np.zeros(0, np.float32)
        self.t = 0
        self.act = 0.0
        self.e_fast = self.e_slow = -60.0
        self.f0_mu, self.f0_var, self.f0_n = math.log(180.0), 0.04, 0
        self.f0z = 0.0
        self.ou = np.zeros(3)
        self.lp1 = np.zeros(3)
        self.lp2 = np.zeros(3)
        self.out1 = np.zeros(3)
        self.out2 = np.zeros(3)
        self.turn_from = self.turn_to = self.turn_off = 0.0
        self.turn_t0, self.turn_len = -1, 1
        self.next_turn = int(FPS * self.rng.uniform(1.0, 2.5))
        self.next_nod = 0
        self.nods: list[tuple[int, int, float]] = []  # (start frame, length, depth deg)
        self.prev_emph = 0.0
        self.events: list[tuple[int, str, float]] = []

    # one frame -------------------------------------------------------------------------------
    def _frame(self) -> tuple[float, float, float]:
        db, f0 = frame_features(self.buf)
        voiced = f0 is not None
        speaking = voiced or db > -38
        self.act += (_alpha(0.25) if speaking else _alpha(1.2)) * ((1.0 if speaking else 0.0) - self.act)
        self.e_fast += _alpha(0.08) * (max(db, -60) - self.e_fast)
        self.e_slow += _alpha(1.5) * (max(db, -60) - self.e_slow)
        if voiced:
            lf = math.log(f0)
            a = _alpha(3.0) if self.f0_n > 25 else 1.0 / (self.f0_n + 1)
            d = lf - self.f0_mu
            self.f0_mu += a * d
            self.f0_var += a * (d * d - self.f0_var)
            self.f0_n += 1
            z = d / math.sqrt(max(self.f0_var, 1e-4))
        else:
            z = 0.0
        self.f0z += _alpha(0.4) * (float(np.clip(z, -2.5, 2.5)) - self.f0z)
        emph = (self.e_fast - self.e_slow) if voiced else 0.0
        t = self.t

        # drift: OU noise (tau 1.5 s), band-limited by two one-pole low-passes (~0.5 Hz)
        sig = np.array([1.0, 1.0, 1.0])
        self.ou += _alpha(0.6) * (-self.ou) + sig * math.sqrt(2 * DT / 0.6) * self.rng.standard_normal(3)
        a = _alpha(0.08)
        self.lp1 += a * (self.ou - self.lp1)
        self.lp2 += a * (self.lp1 - self.lp2)
        amp = 0.35 + 0.65 * self.act
        drift = self.lp2 * np.array([3.6, 2.0, 1.3]) * amp  # yaw, pitch, roll (lp2 SD ~0.45)

        # turns (yaw) on emphasis, with F0 up
        if t >= self.next_turn and voiced and emph > 4.0 and self.f0z > 0.2:
            if self.rng.uniform() < 0.6:
                size = self.rng.uniform(6.0, 10.0)
                cur = self.turn_off
                side = -math.copysign(1.0, cur) if abs(cur) > 2.0 else self.rng.choice([-1.0, 1.0])
                target = float(np.clip(cur + side * size, -10.0, 10.0))
                if abs(target - cur) < 4.0:
                    target = float(np.clip(cur - side * size, -10.0, 10.0))
                self.turn_from, self.turn_to = cur, target
                self.turn_t0, self.turn_len = t, int(FPS * self.rng.uniform(0.8, 1.2))
                self.events.append((t, "turn", target))
            self.next_turn = t + int(FPS * self.rng.uniform(2.5, 5.0))
        if 0 <= self.turn_t0 and t - self.turn_t0 <= self.turn_len:
            u = (t - self.turn_t0) / self.turn_len
            s = u * u * (3 - 2 * u)
            self.turn_off = self.turn_from + (self.turn_to - self.turn_from) * s
        else:
            self.turn_off += _alpha(4.0) * (0.0 - self.turn_off) * (0.3 + 0.7 * (1 - self.act))
            self.turn_from = self.turn_to = self.turn_off

        # nods on emphasis onsets
        if t >= self.next_nod and voiced and emph > 5.0 and self.prev_emph <= 5.0:
            depth = self.rng.uniform(1.5, 3.0)
            self.nods.append((t, int(FPS * 0.5), depth))
            self.events.append((t, "nod", depth))
            self.next_nod = t + int(FPS * self.rng.uniform(1.2, 2.6))
        self.prev_emph = emph
        nod = 0.0
        for t0, n, depth in self.nods:
            if t0 <= t < t0 + n:
                nod += depth * math.sin(math.pi * (t - t0) / n) ** 2
        self.nods = [x for x in self.nods if t < x[0] + x[1]]

        raw = drift + np.array([self.turn_off, nod - 0.9 * self.f0z * self.act, 0.0])
        raw[2] += 0.15 * raw[0]
        b = _alpha(0.09)  # final smoothing, two passes (~1.8 Hz)
        self.out1 += b * (raw - self.out1)
        self.out2 += b * (self.out1 - self.out2)
        y, p, r = self.out2 * self.scale
        self.t += 1
        return 14 * math.tanh(y / 14), 8 * math.tanh(p / 8), 6 * math.tanh(r / 6)

    def feed(self, audio16k: np.ndarray) -> np.ndarray:
        """Append audio; returns (n, 3) float32 [yaw, pitch, roll] for each completed frame."""
        self.pending = np.concatenate([self.pending, np.asarray(audio16k, np.float32).ravel()])
        out = []
        while len(self.pending) >= HOP:
            hop, self.pending = self.pending[:HOP], self.pending[HOP:]
            self.buf = np.concatenate([self.buf[HOP:], hop])
            out.append(self._frame())
        return np.asarray(out, np.float32).reshape(-1, 3)


def track_for(audio16k: np.ndarray, n_frames: int | None = None, seed: int = 1117,
              scale: float = 1.0) -> np.ndarray:
    """The whole track for an audio clip, padded with silence to `n_frames` when given."""
    st = StatTrack(seed, scale)
    if n_frames is not None and len(audio16k) < n_frames * HOP:
        audio16k = np.concatenate([audio16k, np.zeros(n_frames * HOP - len(audio16k), np.float32)])
    out = st.feed(audio16k)
    return out[:n_frames] if n_frames is not None else out


def stats(track: np.ndarray, mask: np.ndarray | None = None) -> dict:
    """SD, p95-p5 range and mean angular speed (deg/s) per axis, over `mask` frames."""
    v = np.abs(np.diff(track, axis=0)) * FPS
    m = np.ones(len(track), bool) if mask is None else mask
    out = {}
    for i, k in enumerate(("yaw", "pitch", "roll")):
        x = track[m, i]
        out[k] = {"sd": round(float(x.std()), 2),
                  "range": round(float(np.percentile(x, 95) - np.percentile(x, 5)), 2),
                  "max": round(float(np.abs(x).max()), 2),
                  "speed": round(float(v[m[1:], i].mean()), 2)}
    s = np.linalg.norm(np.diff(track, axis=0), axis=1) * FPS
    out["speed"] = round(float(s[m[1:]].mean()), 2)
    out["accelP95"] = round(float(np.percentile(np.abs(np.diff(track, 2, axis=0)) * FPS * FPS, 95)), 1)
    return out


def save_npz(path, track: np.ndarray, audio: str) -> None:
    np.savez(path, yaw=track[:, 0].astype(np.float32), pitch=track[:, 1].astype(np.float32),
             roll=track[:, 2].astype(np.float32), fps=np.float32(FPS), audio=np.str_(audio))


def load_npz(path) -> np.ndarray:
    d = np.load(path)
    assert int(round(float(d["fps"]))) == FPS, d["fps"]
    return np.stack([d["yaw"], d["pitch"], d["roll"]], 1).astype(np.float32)
