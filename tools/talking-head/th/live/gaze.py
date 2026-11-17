"""Gaze glances (round 3): Iris looks away for about a second, then back.

References. Iris's Codex gaze edits (`assets/characters/companions/iris/edits/gaze{L,R,U,D}.webp`)
are bust-cropped exactly like the main portrait (models.BUST_BOX) and registered with FlashHead as
extra identities next to the main one (models.FlashHeadModel.add_reference). A switch replaces the
reference latent and the colour reference but keeps FlashHead's motion latents, so the next chunk
continues from the last frames instead of restarting from the still reference (measured in
docs/talking-head.md "Round 3").

Policy (`GazePolicy.decide`, one call per chunk, on the GPU thread). A reference applies to a whole
chunk (FlashHead takes it per 0.96 s slice), so a glance lasts one chunk:
- during speech, a chunk that holds a sentence boundary starts a glance with probability P_SPEECH;
- in idle, one glance every IDLE_S seconds (uniform), planned one chunk ahead so the engine
  can fade the live model in over the idle loop before it;
- never two glance chunks in a row, and never within MIN_GAP_S of the previous glance;
- direction: left or right (DIRS, SPEECH_DIRS); up and down are registered but not scheduled, as
  the probes showed no glance (up) or drooping lids (down);
- `plain` (the default): idle glances only, as the owner approved in round 3, none in speech;
- `lively` glances more often, `off` never; speech glances have their own switch (`speech`).
Deterministic for a seed and the same calls.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np

LEVELS = ("plain", "off", "natural", "lively")
DIRS = {"L": 0.5, "R": 0.5}  # idle direction weights (probes: gazeU shows nothing in idle and a half
SPEECH_DIRS = {"L": 0.5, "R": 0.5}  # blink in speech; gazeD reads as drooping lids for 2 chunks)
EDIT_DIRS = ("L", "R", "U", "D")  # the gaze edits cropped and registered (U and D kept for probes)
P_SPEECH = {"plain": 0.0, "off": 0.0, "natural": 0.3, "lively": 0.5}  # per chunk that holds a sentence boundary
IDLE_S = {"plain": (6.0, 10.0), "off": None, "natural": (6.0, 10.0), "lively": (4.0, 7.0)}
MIN_GAP_S = {"plain": 3.0, "off": 0.0, "natural": 3.0, "lively": 2.0}
MAIN = "main"


def speech_glances_default() -> bool:
    import os

    return os.environ.get("TH_LIVE_SPEECH_GLANCES", "1") != "0"


def ref_name(d: str) -> str:
    return f"gaze{d}"


def edits_dir() -> Path:
    from ..paths import portrait_path

    return portrait_path().parent / "edits"


def gaze_refs(out: Path | None = None, src: Path | None = None) -> dict[str, Path]:
    """The bust-cropped gaze references, written once to $TH_HOME/live/refs/iris/gaze?.png (rewritten
    when an edit is newer). Missing edits are skipped."""
    from PIL import Image

    from ..paths import th_home
    from .models import BUST_BOX

    src = src or edits_dir()
    out = out or th_home() / "live" / "refs" / "iris"
    refs: dict[str, Path] = {}
    for d in EDIT_DIRS:
        s = src / f"{ref_name(d)}.webp"
        if not s.is_file():
            continue
        dst = out / f"{ref_name(d)}.png"
        if not dst.is_file() or dst.stat().st_mtime < s.stat().st_mtime:
            dst.parent.mkdir(parents=True, exist_ok=True)
            Image.open(s).convert("RGB").crop(BUST_BOX).save(dst)
        refs[ref_name(d)] = dst
    return refs


class GazePolicy:
    def __init__(self, level: str = "plain", seed: int = 1116, chunk_ms: float = 960.0,
                 available: Iterable[str] | None = None, speech: bool | None = None) -> None:
        """`speech`: glances at sentence boundaries too (default on; TH_LIVE_SPEECH_GLANCES=0 or
        `th live --no-speech-glances` turn them off, idle glances stay)."""
        self.speech = speech_glances_default() if speech is None else speech
        self.rng = np.random.default_rng(seed + 7)
        self.chunk_ms = chunk_ms
        self.available = set(available) if available is not None else {ref_name(d) for d in EDIT_DIRS}
        self.level = "natural"
        self.set_level(level)
        self.last_k = -10**9  # chunk of the last glance
        self.current = MAIN
        self.next_idle_ms: float | None = None
        self.planned: tuple[int, str] | None = None  # an idle glance at the next chunk
        self.log: list[tuple[int, str]] = []  # (chunk, reference) for every glance shown

    def set_level(self, level: str) -> None:
        assert level in LEVELS, level
        self.level = level
        self.next_idle_ms = None  # re-drawn at the next idle chunk
        if level == "off":
            self.planned = None

    def _pick(self, weights: dict[str, float]) -> str | None:
        dirs = [d for d in weights if ref_name(d) in self.available]
        if not dirs:
            return None
        p = np.array([weights[d] for d in dirs])
        return ref_name(dirs[int(self.rng.choice(len(dirs), p=p / p.sum()))])

    def _draw_idle(self, t_ms: float) -> None:
        lo, hi = IDLE_S[self.level] or (0.0, 0.0)
        self.next_idle_ms = t_ms + float(self.rng.uniform(lo, hi)) * 1000

    def _gap_ok(self, k: int) -> bool:
        return k - self.last_k > 1 and (k - self.last_k) * self.chunk_ms >= MIN_GAP_S[self.level] * 1000

    def decide(self, k: int, boundaries: int, speaking: bool) -> str:
        """The reference for chunk k: MAIN or a gaze reference. `boundaries`: how many sentence
        starts the chunk's slice holds; `speaking`: the slice carries speech. An idle glance is
        planned one chunk ahead (`planned`), so the engine can show the live model over the idle
        loop from a few frames before it; speech cancels a planned one."""
        ref = MAIN
        planned, self.planned = self.planned, None
        if self.level == "off":
            pass
        elif speaking:
            self.next_idle_ms = None
            if self.speech and boundaries and self._gap_ok(k) and self.rng.random() < P_SPEECH[self.level]:
                ref = self._pick(SPEECH_DIRS) or MAIN
        else:
            if planned is not None and planned[0] == k:
                ref = planned[1]
            t_next = (k + 1) * self.chunk_ms
            if self.next_idle_ms is None:
                self._draw_idle(k * self.chunk_ms)
            if ref == MAIN and t_next >= self.next_idle_ms and self._gap_ok(k + 1):
                nxt = self._pick(DIRS)
                if nxt is not None:
                    self.planned = (k + 1, nxt)
                self._draw_idle(t_next)
        if ref != MAIN:
            self.last_k = k
            self.log.append((k, ref))
        self.current = ref
        return ref
