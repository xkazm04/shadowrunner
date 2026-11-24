"""Re-anchoring the Flash arm across a passage's windows (spec iris-hands round 3, req 10).

(a) Per-window prompts tied to the beats of `passage.wav` ("Let me show you three reasons teams
switch to Beacon. First, it is fast ... Second, it is private ... And finally, it is affordable
..."). Sentence gaps (silence over 0.24 s) sit at 3.0-3.6, 7.5-8.0 and 11.9-12.5 s; the 425-frame
passage renders as windows starting at 0, 4.16, 8.32 and 12.48 s, so window 1 holds the intro and
"First,", window 2 the first point, window 3 the second and window 4 "And finally". Each beat
prompt uses the demo prompts' template, as `emv3.GESTURE_PROMPT` does.

(b) A fresh reference each window: the CLIP identity image of every window after the first becomes
an open-hands pose frame (picked from a gesturing take by `pick_pose`), the motion frames kept.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .handcheck import FrameCheck, Hand, track

HEAD = ("A woman with a silver-grey bob and a black headset stands waist-up facing the camera. As "
        "the video progresses, the character speaks while ")
TAIL = (", with natural arm and body movements consistent with presenting. Don't blink too often. "
        "Preserve background integrity matching the reference image's spatial configuration, "
        "lighting conditions, and color temperature.")
BEATS = (
    "she opens both hands toward the viewer at chest height and then raises three fingers to "
    "announce three reasons",
    "she raises one finger at chest height to mark the first point, then makes a quick, light "
    "chopping gesture with her open hand",
    "she raises two fingers at chest height to mark the second point, then lays one open hand flat "
    "on her chest",
    "she raises three fingers at chest height for the last point, then opens both palms wide "
    "toward the viewer",
)
TIPS = (4, 8, 12, 16, 20)   # MediaPipe hand landmarks: thumb, index, middle, ring, pinky tips
MCP = (5, 9, 13, 17)        # finger bases


def beat_prompts() -> list[str]:
    return [HEAD + b + TAIL for b in BEATS]


def openness(xy: np.ndarray) -> float:
    """How open a hand is: mean fingertip distance from the wrist over the palm length (wrist to
    middle base); a fist is about 1, an open hand about 2."""
    palm = float(np.linalg.norm(xy[9] - xy[0])) or 1e-6
    return float(np.mean([np.linalg.norm(xy[t] - xy[0]) for t in TIPS])) / palm


def pick_pose(frames: list[list[Hand]], checks: list[FrameCheck], min_open: float = 1.7,
              margin: int = 2) -> int | None:
    """The frame with both hands found, apart (not clasped), open (`openness` >= min_open), with no
    flag within +-margin frames, whose wrists are highest (smallest mean y: hands raised to chest
    height). None when no frame qualifies."""
    tracks = track(frames)
    best, best_y = None, None
    for i, t in enumerate(tracks):
        if len(t) < 2 or checks[i].clasped:
            continue
        if any(checks[j].flags for j in range(max(0, i - margin), min(len(checks), i + margin + 1))):
            continue
        if min(openness(h.xy) for h in t.values()) < min_open:
            continue
        y = float(np.mean([h.xy[0, 1] for h in t.values()]))
        if best_y is None or y < best_y:
            best, best_y = i, y
    return best


def write(path: Path, prompts: list[str] | None, poses: list[str] | None,
          end_pose: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"prompts": prompts or [], "poses": poses or [], "endPose": end_pose}
    path.write_text(json.dumps(body, indent=1) + "\n", encoding="utf-8")
    return path


def extract_pose(clip: Path, out: Path) -> tuple[Path, int]:
    """Pick the pose frame of a finished take (its hands.npz from the hand check) and save it."""
    from PIL import Image

    from ...ffmpeg import read_frames
    from .handcheck import check
    from .handscan import scan_cached
    from .measure import FPS

    hands, size = scan_cached(clip, clip.parent / "hands.npz")
    i = pick_pose(hands, check(hands, size))
    if i is None:
        raise SystemExit(f"hands: no open-hands frame in {clip}")
    for k, f in enumerate(read_frames(clip, size, fps=FPS)):
        if k == i:
            out.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(f).save(out)
            return out, i
    raise SystemExit(f"hands: frame {i} not read from {clip}")
