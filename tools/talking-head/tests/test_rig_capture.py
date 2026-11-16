"""The timeline capture (scripts/portrait/timeline-capture.mjs over apps/web/bench/timeline.html):
two captures of one 3 s timeline give identical frames. Needs node, the checkout's node_modules,
the built Iris pack and ffmpeg; takes the GPU lock like any render (about 15 s)."""

import math

import pytest

from th.arms.base import ArmNotBuilt
from th.rig.timeline import FPS, SCHEMA, Expression, Frame, Timeline

from conftest import HAS_FFMPEG


def _ready() -> str | None:
    if not HAS_FFMPEG:
        return "ffmpeg not on PATH"
    from th.rig.capture import check_ready

    try:
        check_ready()
    except ArmNotBuilt as e:
        return str(e)
    return None


SKIP = _ready()


def three_seconds() -> Timeline:
    frames = []
    for i in range(3 * FPS):
        open_ = max(0.0, math.sin(i / 4))
        frames.append(Frame(
            t=round(i / FPS, 6), mouth={"openMid": round(open_, 4), "rest": round(1 - open_, 4)},
            mouthGain=1.0 if i < 45 else 1.3,
            expression=Expression(family="joy", w=0.8) if 30 <= i < 70 else None,
            gesture="nod" if i == 20 else ("tilt" if i == 60 else None), blink=None, gaze=None))
    return Timeline(schema=SCHEMA, fps=FPS, frames=frames)


@pytest.mark.skipif(SKIP is not None, reason=f"timeline capture not ready: {SKIP}")
def test_two_captures_of_one_timeline_are_frame_identical(tmp_path):
    from th.gpu import gpu_lock
    from th.rig.capture import capture

    tl = three_seconds().write(tmp_path / "timeline.json")
    runs = []
    with gpu_lock():
        for n in (1, 2):
            hashes = tmp_path / f"hashes-{n}.txt"
            capture(tmp_path / f"cap-{n}.mp4", log=tmp_path / "log.txt", timeline=tl, hashes=hashes, size=512)
            runs.append(hashes.read_text().split())
    assert len(runs[0]) == 3 * FPS
    assert runs[0] == runs[1]
    assert len(set(runs[0])) > 60  # the face moves: not one frame repeated
