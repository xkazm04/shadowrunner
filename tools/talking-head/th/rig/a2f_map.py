"""Audio2Face-3D blendshape weights (ARKit-style names, one row per 30 fps frame) -> th-timeline/1.

Measured first (pitch-45s, Mark v2.3, neutral emotion): Mark's REST face is not zero. In silence
jawOpen sits at 0.09, mouthShrugLower at 0.39, mouthSmile at 0.12 and mouthStretch at 0.15, and
the upper face hardly moves at all (browInnerUp max 0.037, browOuterUp 0). Raw weights would hold
Iris's mouth half-open forever. So every channel is first made relative to the clip's own rest and
range:

  rest_c  = median of channel c over the rest frames (jawOpen at or under its 20th percentile)
  n_c     = clamp((c - rest_c) / max(p95_c - rest_c, MIN_SPAN), 0, 1)    (MIN_SPAN keeps noise at 0)

`L/R` pairs are averaged. Then (ramp(x, a, b) = clamp((x - a) / (b - a), 0, 1)):

Mouth (`mouth`, a mix that sums to <= 1, rest takes what is left):
  aperture  = n(jawOpen) x (1 - n(mouthClose))
  roundness = max(n(mouthFunnel), n(mouthPucker))
  wideness  = n(mouthStretch)
  seal      = max(n(mouthPress), n(mouthRollLower), n(mouthRollUpper))
  openWide  = ramp(aperture, 0.55, 0.95) x (1 - roundness)
  openMid   = ramp(aperture, 0.12, 0.55) x (1 - ramp(aperture, 0.55, 0.95)) x (1 - roundness)
  round     = roundness x ramp(roundness, 0.25, 0.7)
  narrow    = ramp(wideness, 0.3, 0.9) x (1 - roundness) x (1 - ramp(aperture, 0.3, 0.6))
  teeth     = ramp(n(mouthUpperUp), 0.3, 0.9) x (1 - roundness) x (1 - ramp(aperture, 0.3, 0.6))
  closed    = ramp(seal x (1 - aperture), 0.4, 0.9)
  tongue    = ramp(n(tongueOut), 0.3, 0.9)
  then scaled down to a total of 1 when above it. The rig's own per-shape `mouthGain` (Iris:
  openWide 0.45, openMid 0.7, round 0.6, tongue 0.7, narrow 0.75) applies after this, as for the
  studio's lip-sync.

Amplitude (`mouthGain` = Look.face.mouth.size, 0.3..1.5): MOUTH_SIZE_BASE + MOUTH_SIZE_JAW x n(jawOpen)
  eased over 0.2 s: stressed syllables open a little wider than quiet ones.

Expression (`expression`): raw weights minus their rest (not range-normalised, so noise stays small),
  each score eased over EXPR_EASE_S:
  joy = mouthSmile + 0.5 cheekSquint; smug = 2 |mouthSmileL - mouthSmileR|; anger = browDown + 0.5
  noseSneer; gloom = mouthFrown + 0.5 browInnerUp; showman = browOuterUp + 0.5 browInnerUp;
  suspicion = eyeSquint x (1 - mouthSmile). The best score at or above EXPR_ON shows (w = score /
  EXPR_FULL, capped at 1), held at least EXPR_HOLD_S, leaving below EXPR_OFF.
  Without an emotion input (Audio2Emotion is gated) A2F moves the upper face by a few hundredths,
  so on a neutral read this stays null: the player's own mood holds.

Gestures (`gesture`), never twitching. energy = n(jawOpen) eased over 0.25 s. A2F holds the jaw a
  little open through short pauses (energy 0.26 in silence, 0.39 in speech, medians), so both
  thresholds are the clip's own percentiles:
  nod  at a local maximum of energy at or above its NOD_PERCENTILE (a stressed syllable), at most
       once per NOD_REFRACTORY_S;
  tilt at a phrase start: energy rising past its PAUSE_PERCENTILE after >= TILT_PAUSE_S under it,
       at most once per TILT_REFRACTORY_S;
  never two gestures within GESTURE_GAP_S. A gesture is written on one frame (the player plays it out).

`blink` and `gaze` are null: the player's own blink and gaze run (no public API takes them).
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from .timeline import FPS, SCHEMA, Expression, Frame, Timeline

MIN_SPAN = 0.05
REST_PERCENTILE = 20
MOUTH_SIZE_BASE = 0.85
MOUTH_SIZE_JAW = 0.3
EXPR_EASE_S = 0.6
EXPR_ON = 0.3
EXPR_OFF = 0.18
EXPR_FULL = 0.7
EXPR_HOLD_S = 1.2
NOD_PERCENTILE = 92
NOD_REFRACTORY_S = 4.0
PAUSE_PERCENTILE = 30
TILT_PAUSE_S = 0.5
TILT_REFRACTORY_S = 6.0
GESTURE_GAP_S = 1.0

FAMILY_ORDER = ("joy", "smug", "anger", "gloom", "showman", "suspicion")


def read_weights(csv_path: Path) -> dict[str, np.ndarray]:
    """The SDK tool's CSV (frame, t, then one column per pose) as {pose name: per-frame array}."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    head, body = rows[0], rows[1:]
    data = np.array([[float(v) for v in r] for r in body], dtype=np.float64) if body else np.zeros((0, len(head)))
    return {name: data[:, i] for i, name in enumerate(head) if name not in ("frame", "t")}


def _ch(w: dict[str, np.ndarray], n: int, *names: str) -> np.ndarray:
    """The mean of the named channels that exist (a name also matches its Left/Right pair)."""
    found = []
    for name in names:
        for key in (name, name + "Left", name + "Right"):
            if key in w:
                found.append(w[key][:n])
    return np.clip(np.mean(found, axis=0), 0, 1) if found else np.zeros(n)


def ramp(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip((x - lo) / (hi - lo), 0, 1)


def ease(x: np.ndarray, seconds: float) -> np.ndarray:
    """One-pole low-pass over frames (time constant `seconds`), forward only."""
    if seconds <= 0 or len(x) == 0:
        return x.copy()
    k = 1 - math.exp(-1 / (seconds * FPS))
    out = np.empty_like(x)
    acc = float(x[0])
    for i, v in enumerate(x):
        acc += (float(v) - acc) * k
        out[i] = acc
    return out


class Channels:
    """Per-channel rest and range over one clip (the module header)."""

    def __init__(self, w: dict[str, np.ndarray], n: int) -> None:
        self.w, self.n = w, n
        jaw = _ch(w, n, "jawOpen")
        self.rest_frames = jaw <= np.percentile(jaw, REST_PERCENTILE) if n else np.zeros(0, bool)

    def rest(self, x: np.ndarray) -> float:
        return float(np.median(x[self.rest_frames])) if self.rest_frames.any() else 0.0

    def raw(self, *names: str) -> np.ndarray:
        """The channel minus its rest, floored at 0."""
        x = _ch(self.w, self.n, *names)
        return np.clip(x - self.rest(x), 0, 1) if self.n else x

    def norm(self, *names: str) -> np.ndarray:
        """0 at rest, 1 at the clip's 95th percentile."""
        x = _ch(self.w, self.n, *names)
        if not self.n:
            return x
        base = self.rest(x)
        span = float(np.percentile(x, 95)) - base
        return np.clip((x - base) / span, 0, 1) if span >= MIN_SPAN else np.zeros(self.n)


def mouth_mix(c: Channels) -> dict[str, np.ndarray]:
    """Per frame, the seven speaking shapes (rest is the remainder); see the module table."""
    aperture = c.norm("jawOpen") * (1 - c.norm("mouthClose"))
    roundness = np.maximum(c.norm("mouthFunnel"), c.norm("mouthPucker"))
    seal = np.maximum.reduce([c.norm("mouthPress"), c.norm("mouthRollLower"), c.norm("mouthRollUpper")])
    flat = 1 - roundness
    small = 1 - ramp(aperture, 0.3, 0.6)
    wide = ramp(aperture, 0.55, 0.95)
    mix = {
        "openWide": wide * flat,
        "openMid": ramp(aperture, 0.12, 0.55) * (1 - wide) * flat,
        "round": roundness * ramp(roundness, 0.25, 0.7),
        "narrow": ramp(c.norm("mouthStretch"), 0.3, 0.9) * flat * small,
        "teeth": ramp(c.norm("mouthUpperUp"), 0.3, 0.9) * flat * small,
        "closed": ramp(seal * (1 - aperture), 0.4, 0.9),
        "tongue": ramp(c.norm("tongueOut"), 0.3, 0.9),
    }
    total = sum(mix.values())
    scale = np.where(total > 1, 1 / np.maximum(total, 1e-9), 1.0)
    return {k: v * scale for k, v in mix.items()}


def family_scores(c: Channels) -> dict[str, np.ndarray]:
    smile = c.raw("mouthSmile")
    inner, outer = c.raw("browInnerUp"), c.raw("browOuterUp")
    raw = {
        "joy": smile + 0.5 * c.raw("cheekSquint"),
        "smug": 2 * np.abs(c.raw("mouthSmileLeft") - c.raw("mouthSmileRight")),
        "anger": c.raw("browDown") + 0.5 * c.raw("noseSneer"),
        "gloom": c.raw("mouthFrown") + 0.5 * inner,
        "showman": outer + 0.5 * inner,
        "suspicion": c.raw("eyeSquint") * (1 - smile),
    }
    return {k: ease(v, EXPR_EASE_S) for k, v in raw.items()}


def expressions(scores: dict[str, np.ndarray], n: int) -> list[Expression | None]:
    out: list[Expression | None] = []
    shown: str | None = None
    since = 0
    hold = EXPR_HOLD_S * FPS
    for i in range(n):
        best = max(FAMILY_ORDER, key=lambda f: scores[f][i])
        if shown is not None and scores[shown][i] < EXPR_OFF and i - since >= hold:
            shown = None
        if shown is None and scores[best][i] >= EXPR_ON:
            shown, since = best, i
        elif shown is not None and best != shown and scores[best][i] >= EXPR_ON and \
                scores[best][i] > scores[shown][i] + 0.1 and i - since >= hold:
            shown, since = best, i
        out.append(None if shown is None else
                   Expression(family=shown, w=round(float(min(1.0, scores[shown][i] / EXPR_FULL)), 4)))
    return out


def gestures(c: Channels) -> list[str | None]:
    energy = ease(c.norm("jawOpen"), 0.25)
    n = c.n
    if n == 0:
        return []
    speech_on = float(np.percentile(energy, PAUSE_PERCENTILE))
    nod_at = float(np.percentile(energy, NOD_PERCENTILE))
    out: list[str | None] = [None] * n
    last_nod = last_tilt = last_any = -10**9
    quiet = 0
    for i in range(n):
        if energy[i] < speech_on:
            quiet += 1
            continue
        if quiet >= TILT_PAUSE_S * FPS and i - last_tilt >= TILT_REFRACTORY_S * FPS and i - last_any >= GESTURE_GAP_S * FPS:
            out[i], last_tilt, last_any = "tilt", i, i
        elif 0 < i < n - 1 and energy[i] >= nod_at and energy[i] >= energy[i - 1] and energy[i] > energy[i + 1] \
                and i - last_nod >= NOD_REFRACTORY_S * FPS and i - last_any >= GESTURE_GAP_S * FPS:
            out[i], last_nod, last_any = "nod", i, i
        quiet = 0
    return out


def to_timeline(w: dict[str, np.ndarray], frames: int) -> Timeline:
    """`frames` timeline frames (the audio's length at 30 fps); A2F frames past it are dropped, and
    missing ones at the end are rest."""
    have = min(frames, min((len(v) for v in w.values()), default=0))
    c = Channels(w, have)
    mix = mouth_mix(c)
    size = np.clip(MOUTH_SIZE_BASE + MOUTH_SIZE_JAW * ease(c.norm("jawOpen"), 0.2), 0.3, 1.5)
    expr = expressions(family_scores(c), have)
    gest = gestures(c)
    out: list[Frame] = []
    for i in range(frames):
        t = round(i / FPS, 6)
        if i >= have:
            out.append(Frame(t=t, mouth={"rest": 1.0}, mouthGain=None, expression=None, gesture=None, blink=None, gaze=None))
            continue
        shapes = {k: round(float(v[i]), 4) for k, v in mix.items() if v[i] > 1e-4}
        shapes["rest"] = round(max(0.0, 1 - sum(shapes.values())), 4)
        out.append(Frame(t=t, mouth=shapes, mouthGain=round(float(size[i]), 4), expression=expr[i],
                         gesture=gest[i], blink=None, gaze=None))  # type: ignore[arg-type]
    return Timeline(schema=SCHEMA, fps=FPS, frames=out)


def summary(tl: Timeline) -> str:
    """One line for the run notes: how much the mapper used each channel."""
    n = len(tl.frames)
    fams: dict[str, int] = {}
    for f in tl.frames:
        if f.expression is not None:
            fams[f.expression.family] = fams.get(f.expression.family, 0) + 1
    g = [f.gesture for f in tl.frames if f.gesture]
    speaking = sum(1 for f in tl.frames if f.mouth and f.mouth.get("rest", 1) < 0.9)
    fam = ", ".join(f"{k} {v / n:.0%}" for k, v in sorted(fams.items(), key=lambda kv: -kv[1])) or "none"
    return (f"{n} frames; mouth open on {speaking / n:.0%}; expression {fam}; "
            f"gestures {g.count('nod')} nod, {g.count('tilt')} tilt")
