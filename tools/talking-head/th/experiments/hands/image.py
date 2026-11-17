"""Waist-up Iris variants: face identity (DINOv2 on the face crop, as `th.post.identity`) against the
portrait, plus where the face sits, so a variant can be chosen by number and then by eye (hands)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from ...post.face import FaceTracker, square_crop
from ...post.identity import CROP, MARGIN, Embedder


@dataclass(frozen=True)
class Variant:
    path: Path
    size: tuple[int, int]
    identity: float | None       # cosine vs the portrait's face crop
    face: list[int] | None       # x, y, w, h of the landmark extent
    face_frac: float | None      # face height / image height


def face_frac(face_h: float, image_h: int) -> float:
    return round(face_h / image_h, 4)


def score(portrait: Path, variants: list[Path], device: str = "cuda") -> list[Variant]:
    crops: list[np.ndarray] = []
    rows: list[tuple[Path, tuple[int, int], list[int] | None, float | None, int | None]] = []
    with FaceTracker() as tracker:
        ref_rgb = np.asarray(Image.open(portrait).convert("RGB"))
        ref = tracker.detect(ref_rgb)
        if ref is None:
            raise SystemExit(f"hands: no face in {portrait}")
        crops.append(square_crop(ref_rgb, ref.box, MARGIN, CROP))
        for p in variants:
            rgb = np.asarray(Image.open(p).convert("RGB"))
            f = tracker.detect(rgb)
            size = (rgb.shape[1], rgb.shape[0])
            if f is None:
                rows.append((p, size, None, None, None))
                continue
            x0, y0, x1, y1 = f.box
            crops.append(square_crop(rgb, f.box, MARGIN, CROP))
            rows.append((p, size, [round(x0), round(y0), round(x1 - x0), round(y1 - y0)],
                         face_frac(y1 - y0, rgb.shape[0]), len(crops) - 1))
    emb = Embedder(device)
    try:
        vecs = emb.embed(crops)
    finally:
        emb.close()
    out = []
    for p, size, box, frac, idx in rows:
        ident = None if idx is None else round(float(vecs[idx] @ vecs[0]), 4)
        out.append(Variant(p, size, ident, box, frac))
    return out
