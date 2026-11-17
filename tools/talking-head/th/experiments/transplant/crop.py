"""The FlashHead face source: a bust crop of the same waist-up image the EchoMimicV3 clip started
from, framed like the live portrait (Iris's 1024 portrait, box (192,140)-(832,780)), so the face
fills FlashHead's 512 frame the way it does live (round-1 probe: the tighter, the better identity).

The live crop's MediaPipe face box, as fractions of the crop side, measured on the portrait:
x 0.240-0.753, y 0.157-0.737. The bust crop puts the waist image's face box at the same place.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

LIVE_FACE = (0.240, 0.157, 0.753, 0.737)  # x0, y0, x1, y1 / side, in the live portrait crop
OUT = 512


def bust_box(face: tuple[float, float, float, float], size: tuple[int, int],
             target: tuple[float, float, float, float] = LIVE_FACE) -> tuple[int, int, int, int]:
    """A square (x0, y0, x1, y1) that puts `face` at `target`'s place and size; the side is the mean
    of the width and height fits, and the box is shifted (never shrunk) to stay inside `size`."""
    fx0, fy0, fx1, fy1 = face
    tx0, ty0, tx1, ty1 = target
    side = ((fx1 - fx0) / (tx1 - tx0) + (fy1 - fy0) / (ty1 - ty0)) / 2
    side = min(side, size[0], size[1])
    x0 = fx0 - tx0 * side
    y0 = fy0 - ty0 * side
    x0 = min(max(0.0, x0), size[0] - side)
    y0 = min(max(0.0, y0), size[1] - side)
    s = int(round(side))
    return int(round(x0)), int(round(y0)), int(round(x0)) + s, int(round(y0)) + s


def bust_crop(waist: Path, out: Path) -> dict:
    from ...post.face import FaceTracker

    img = Image.open(waist).convert("RGB")
    with FaceTracker() as t:
        face = t.detect(np.asarray(img))
    if face is None:
        raise SystemExit(f"transplant: no face in {waist}")
    box = bust_box(face.box, img.size)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.crop(box).resize((OUT, OUT), Image.LANCZOS).save(out)
    return {"image": str(waist), "faceBox": [round(v, 1) for v in face.box], "crop": list(box),
            "out": str(out)}
