"""Sheets for the hand check: crops of the hands in chosen frames, captioned with the frame, the
track (0 = screen-left, 1 = screen-right) and the flags, so a flagged frame can be judged by eye."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from ...ffmpeg import read_frames
from .handcheck import FrameCheck, Hand, track
from .measure import FPS

CROP = 200   # px per tile
PAD = 0.45   # crop margin around the landmark box, as a share of its larger side


def crop_box(xy: np.ndarray, size: tuple[int, int], pad: float = PAD) -> tuple[int, int, int, int]:
    """A square box around the landmarks, padded, clamped inside the frame."""
    lo, hi = xy.min(0), xy.max(0)
    c = (lo + hi) / 2
    half = max(hi - lo) * (0.5 + pad)
    half = max(half, 24.0)
    x0 = int(np.clip(c[0] - half, 0, max(0, size[0] - 2 * half)))
    y0 = int(np.clip(c[1] - half, 0, max(0, size[1] - 2 * half)))
    s = int(min(2 * half, size[0], size[1]))
    return x0, y0, x0 + s, y0 + s


def hand_sheet(video: Path, size: tuple[int, int], hands: list[list[Hand]],
               checks: list[FrameCheck], picks: list[int], out: Path, cols: int = 8,
               title: str = "") -> Path | None:
    """Two tiles per picked frame (track 0, track 1); a missing hand shows the last known box."""
    if not picks:
        return None
    tracks = track(hands)
    want = set(picks)
    frames = {i: f for i, f in enumerate(read_frames(video, size, fps=FPS)) if i in want}
    last: dict[int, np.ndarray] = {}
    boxes: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for i, t in enumerate(tracks):
        for side in (0, 1):
            if side in t:
                last[side] = t[side].xy
            if i in want and side in last:
                boxes[(i, side)] = crop_box(last[side], size)
    tiles = [(i, side) for i in picks for side in (0, 1) if (i, side) in boxes]
    rows = (len(tiles) + cols - 1) // cols
    head = 22 if title else 0
    canvas = Image.new("RGB", (cols * CROP, head + rows * (CROP + 30)), (12, 12, 14))
    draw = ImageDraw.Draw(canvas)
    if title:
        draw.text((6, 4), title, fill=(235, 235, 235))
    for k, (i, side) in enumerate(tiles):
        x, y = (k % cols) * CROP, head + (k // cols) * (CROP + 30)
        tile = Image.fromarray(frames[i]).crop(boxes[(i, side)]).resize((CROP, CROP), Image.LANCZOS)
        canvas.paste(tile, (x, y))
        flags = [f.split(":", 1)[1] for f in checks[i].flags if f.startswith(f"{side}:")]
        bad = bool(flags)
        draw.rectangle([x, y, x + CROP - 1, y + CROP - 1], outline=(220, 60, 60) if bad else (60, 160, 90),
                       width=2)
        draw.text((x + 4, y + CROP + 2), f"f{i} {i / FPS:.2f}s t{side}", fill=(220, 220, 220))
        draw.text((x + 4, y + CROP + 15), ",".join(flags)[:34] or "ok",
                  fill=(240, 120, 120) if bad else (140, 210, 150))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return out


def report(clip: Path, out_dir: Path, max_tiles: int = 24) -> dict:
    """Scan, check and score a clip: hands.json, hands-worst.png (the worst 0.5 s window, every
    frame) and hands-flagged.png (up to `max_tiles` flagged frames, evenly picked)."""
    import json

    from .handcheck import WINDOW, check, score
    from .handscan import scan_cached

    hands, size = scan_cached(clip, out_dir / "hands.npz")
    checks = check(hands, size)
    s = score(checks)
    kinds: dict[str, int] = {}
    for c in checks:
        for f in c.flags:
            k = f.split(":")[1].split("=")[0]
            kinds[k] = kinds.get(k, 0) + 1
    worst = None
    if s.worst_at is not None:
        picks = list(range(s.worst_at, min(len(checks), s.worst_at + WINDOW)))
        worst = hand_sheet(clip, size, hands, checks, picks, out_dir / "hands-worst.png", cols=8,
                           title=f"{clip.parent.name}: worst 0.5 s window, good share {s.worst_window}")
    flagged = None
    if s.flagged:
        step = max(1, len(s.flagged) / (max_tiles // 2))
        picks = sorted({s.flagged[int(k * step)] for k in range(min(len(s.flagged), max_tiles // 2))})
        flagged = hand_sheet(clip, size, hands, checks, picks, out_dir / "hands-flagged.png", cols=8,
                             title=f"{clip.parent.name}: {len(s.flagged)} flagged frames (sample)")
    out = {"handScore": s.good_share, "handWorst": s.worst_window,
           "handWorstAt": None if s.worst_at is None else round(s.worst_at / FPS, 2),
           "handFrames": s.hand_frames, "frames": s.frames, "flaggedFrames": s.flagged,
           "claspedFrames": sum(1 for c in checks if c.clasped and not c.hands),
           "flagKinds": kinds, "flagsPerFrame": {i: checks[i].flags for i in s.flagged},
           "sheets": [str(p) for p in (worst, flagged) if p]}
    (out_dir / "hands.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out
