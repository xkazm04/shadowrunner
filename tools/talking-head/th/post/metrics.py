"""Metrics over video.mp4: SyncNet conf/offset, DINOv2 identity vs the portrait, faceRoi.

One face pass at 25 fps (the SyncNet rate) gives the face and lip boxes; every 25th frame (1 fps)
also feeds identity. faceRoi = union over the clip of the lip box grown by 25% per side, in
video.mp4 pixels (the jaw drop is inside because every frame's lips are in the union).
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from ..ffmpeg import read_frames
from . import syncnet
from .face import Box, FaceTracker, grow, square_crop, to_xywh, union
from .identity import CROP, MARGIN, Embedder, summarise

ROI_MARGIN = 0.25
# Below this SyncNet confidence the argmin over shifts is noise (a still face scores ~0.05 and its
# "offset" lands on the window edge), so offsetFrames is written as null and the conf kept.
SYNC_MIN_CONF = 1.0


@dataclass
class Metrics:
    sync_conf: float | None = None
    sync_offset: int | None = None
    identity: dict[str, float | None] = field(default_factory=lambda: {"mean": None, "min": None, "p5": None})
    face_roi: list[int] | None = None
    face_box: list[int] | None = None  # median face box (x, y, w, h), for checks and notes
    notes: list[str] = field(default_factory=list)


def audio_16k(video: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(video), "-vn",
         "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.int16)


def portrait_crop(tracker: FaceTracker, portrait: Path, size: tuple[int, int]) -> np.ndarray | None:
    """The portrait letterboxed into `size` exactly as normalise does, then the identity crop."""
    img = Image.open(portrait).convert("RGB")
    scale = min(size[0] / img.width, size[1] / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.BICUBIC)
    canvas = Image.new("RGB", size, (0, 0, 0))
    canvas.paste(img, ((size[0] - img.width) // 2, (size[1] - img.height) // 2))
    rgb = np.asarray(canvas)
    face = tracker.detect(rgb)
    return None if face is None else square_crop(rgb, face.box, MARGIN, CROP)


def measure(video: Path, portrait: Path, size: tuple[int, int] = (1080, 1080),
            device: str = "cuda") -> Metrics:
    m = Metrics()
    boxes: list[Box | None] = []
    lips: list[Box] = []
    id_crops: list[np.ndarray] = []
    with FaceTracker() as tracker:
        ref = portrait_crop(tracker, portrait, size)
        for i, frame in enumerate(read_frames(video, size, fps=syncnet.FPS)):
            face = tracker.detect(frame)
            boxes.append(face.box if face else None)
            if face:
                lips.append(grow(face.lips, ROI_MARGIN))
                if i % syncnet.FPS == 0:
                    id_crops.append(square_crop(frame, face.box, MARGIN, CROP))
    found = [b for b in boxes if b is not None]
    if not found:
        m.notes.append("no face found by MediaPipe; sync, identity and faceRoi are null")
        return m
    roi = union(lips)
    m.face_roi = to_xywh(roi, size) if roi else None
    med = np.median(np.array(found), 0)
    m.face_box = to_xywh((med[0], med[1], med[2], med[3]), size)
    if len(found) < len(boxes):
        m.notes.append(f"face found in {len(found)}/{len(boxes)} frames at 25 fps")

    if ref is None:
        m.notes.append("no face found in the portrait; identity is null")
    elif id_crops:
        emb = Embedder(device)
        try:
            vecs = emb.embed([ref, *id_crops])
        finally:
            emb.close()
        m.identity = summarise(vecs[1:] @ vecs[0])

    smoothed = syncnet.smooth_boxes(boxes)
    if smoothed is None:
        m.notes.append("too few face frames for SyncNet; sync is null")
        return m
    crops = [syncnet.crop_for_syncnet(f, b) for f, b in zip(read_frames(video, size, fps=syncnet.FPS), smoothed)]
    try:
        conf, offset = syncnet.evaluate(crops, audio_16k(video), device=device)
        m.sync_conf = round(conf, 3)
        if conf >= SYNC_MIN_CONF:
            m.sync_offset = offset
        else:
            m.notes.append(f"SyncNet conf {conf:.2f} < {SYNC_MIN_CONF}: no lip sync found, offset null")
    except ValueError as e:
        print(f"th: SyncNet skipped: {e}", file=sys.stderr)
        m.notes.append(f"SyncNet skipped: {e}")
    return m
