"""The P2 evidence for one variant: SyncNet and identity (against Iris's portrait) for EchoMimicV3
alone, the composite and the FlashHead source; jitter of the pasted face on the head; a zoomed sheet
of the face edge at six frames (the fastest head move included); side-by-side clips (full frame,
and the face zoomed) with the line's audio."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from ...ffmpeg import FrameWriter, read_frames, run_ffmpeg
from .composite import native_size
from .jitter import fastest, flow_slide, stats
from .landmarks import Landmarks
from .mask import NOSE_TIP

FPS = 25
ZOOM = 2


def mux(video: Path, wav: Path, out: Path) -> Path:
    """Re-encode at 25 fps (CRF 16) with the wav as AAC; the shorter stream sets the length."""
    run_ffmpeg(["-i", str(video), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-vf",
                f"fps={FPS}", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-b:a", "192k", "-shortest", str(out)])
    return out


def landmarks(video: Path) -> np.ndarray:
    size = native_size(video)
    out = []
    with Landmarks(FPS) as lm:
        for f in read_frames(video, size, fps=FPS):
            p = lm(f)
            out.append(p if p is not None else np.full((478, 2), np.nan))
    return np.array(out)


def face_box(lms: np.ndarray, size: tuple[int, int], grow: float = 0.45) -> tuple[int, int, int, int]:
    """One square box (x0, y0, x1, y1) around every frame's face, grown to show hair and jaw."""
    x0, y0 = np.nanmin(lms[..., 0]), np.nanmin(lms[..., 1])
    x1, y1 = np.nanmax(lms[..., 0]), np.nanmax(lms[..., 1])
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * (0.5 + grow)
    half = min(half, size[0] / 2, size[1] / 2)
    cx, cy = min(max(cx, half), size[0] - half), min(max(cy, half), size[1] - half)
    s = int(2 * half) // 2 * 2
    return int(cx - half), int(cy - half), int(cx - half) + s, int(cy - half) + s


def _label(img: Image.Image, text: str) -> Image.Image:
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 8 + 7 * len(text), 18), fill=(0, 0, 0))
    d.text((4, 3), text, fill=(235, 235, 235))
    return img


def edge_sheet(clip: Path, comp: Path, lms: np.ndarray, out: Path) -> list[int]:
    """Six frames (five evenly spaced, plus the fastest head move), EMV3 | composite, zoomed."""
    size = native_size(clip)
    n = len(lms)
    fast = fastest(lms)
    picks = sorted({*(int((i + 0.5) * n / 5) for i in range(5)), fast})[:6]
    a, b = list(read_frames(clip, size, fps=FPS)), list(read_frames(comp, size, fps=FPS))
    box = face_box(lms, size, grow=0.3)
    side = (box[2] - box[0]) * ZOOM
    tiles = []
    for i in picks:
        pair = []
        for name, frames in (("EMV3", a), ("composite", b)):
            t = Image.fromarray(frames[i]).crop(box).resize((side, side), Image.LANCZOS)
            tag = f"{name} f{i} {i / FPS:.2f}s" + ("  fastest head move" if i == fast else "")
            pair.append(_label(t, tag))
        tiles.append(np.concatenate([np.asarray(p) for p in pair], 1))
    rows = [np.concatenate(tiles[k:k + 2], 1) if k + 1 < len(tiles) else
            np.concatenate([tiles[k], np.zeros_like(tiles[k])], 1) for k in range(0, len(tiles), 2)]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.concatenate(rows, 0)).save(out)
    return picks


def side_by_side(clip: Path, comp: Path, wav: Path, out: Path, box: tuple[int, int, int, int] | None
                 ) -> Path:
    """EMV3 | composite, full frame (box None) or the face box zoomed, with the line's audio."""
    size = native_size(clip)
    if box is None:
        w, h = size
    else:
        w = h = (box[2] - box[0]) * ZOOM
    codec = ["-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "16", "-pix_fmt",
             "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    with FrameWriter(out, (2 * w, h), FPS, "rgb24", codec, extra_inputs=["-i", str(wav)]) as wr:
        for fa, fb in zip(read_frames(clip, size, fps=FPS), read_frames(comp, size, fps=FPS)):
            pair = []
            for name, f in (("EchoMimicV3 alone", fa), ("composite (FlashHead face)", fb)):
                img = Image.fromarray(f)
                if box is not None:
                    img = img.crop(box).resize((w, h), Image.LANCZOS)
                pair.append(np.asarray(_label(img, name)))
            wr.write(np.ascontiguousarray(np.concatenate(pair, 1)))
    return out


def _metrics(videos: dict[str, Path], portrait: Path) -> dict:
    from ...gpu import gpu_lock
    from ...post.metrics import measure
    from ..hands.health import check

    out: dict = {"healthBefore": check().line()}
    with gpu_lock():
        for name, v in videos.items():
            m = measure(v, portrait, size=native_size(v))
            out[name] = {"syncConf": m.sync_conf, "syncOffset": m.sync_offset,
                         "identity": m.identity, "notes": m.notes}
    out["healthAfter"] = check().line()
    return out


def report(p: dict[str, Path], portrait: Path, tag: str = "") -> dict:
    """`tag` names a composite variant (composite<tag>.mp4); its outputs carry the same tag."""
    o = p["out"]
    fh_clip = mux(p["fh"], p["wav"], p["fh"].parent / "clip.mp4")
    fig: dict = {"emv3": str(p["emv3"]), "composite": str(p["composite"]), "fhClip": str(fh_clip)}
    paste_json = p["composite"].with_suffix(".json")
    if paste_json.is_file():
        fig["paste"] = json.loads(paste_json.read_text(encoding="utf-8"))
    data = np.load(p["composite"].with_suffix(".npz"))
    clip_lms = data["clip"]
    size = native_size(p["emv3"])
    box = face_box(clip_lms, size, grow=0.3)
    emv3_frames = list(read_frames(p["emv3"], size, fps=FPS))
    nose = clip_lms[:, NOSE_TIP, 1]  # the flow check reads the face above the nose tip
    fig["jitter"] = {"smoothed": stats(clip_lms, landmarks(p["composite"])),
                     "flowEmv3Alone": flow_slide(emv3_frames, data["alpha"], box, nose),
                     "flowSmoothed": flow_slide(list(read_frames(p["composite"], size, fps=FPS)),
                                                data["alpha"], box, nose)}
    raw = o / "composite-raw.mp4"
    if raw.is_file() and not tag:
        raw_alpha = np.load(raw.with_suffix(".npz"))["alpha"]
        fig["jitter"]["rawFits"] = stats(clip_lms, landmarks(raw))
        fig["jitter"]["flowRawFits"] = flow_slide(list(read_frames(raw, size, fps=FPS)), raw_alpha, box, nose)
    fig["metrics"] = _metrics({"emv3": p["emv3"], "composite": p["composite"], "fh": fh_clip}, portrait)
    fig["edgeSheetFrames"] = edge_sheet(p["emv3"], p["composite"], clip_lms, o / f"edge-sheet{tag}.png")
    fig["edgeSheet"] = str(o / f"edge-sheet{tag}.png")
    fig["sideBySide"] = str(side_by_side(p["emv3"], p["composite"], p["wav"], o / f"sbs{tag}.mp4", None))
    box = face_box(clip_lms, native_size(p["emv3"]))
    fig["sideBySideFace"] = str(side_by_side(p["emv3"], p["composite"], p["wav"], o / f"sbs-face{tag}.mp4", box))
    (o / f"figures{tag}.json").write_text(json.dumps(fig, indent=2) + "\n", encoding="utf-8")
    return fig
