"""Ditto against FlashHead `off` on the same audio and bust (round 5, H2): one figures.json per name.

Inputs under <out>/<name>/: <mode>/raw.mp4 (+ run.json, pose.npz) from `ditto_cli render`, and
fh/raw.mp4 from `ditto_cli fh`. Outputs there:
- figures.json: SyncNet and identity (th.post.metrics, against Iris's portrait), face and mouth
  sharpness, head-motion statistics read by MediaPipe from both clips plus Ditto's own track, body
  stillness (shoulder band change against frame 0), timing and VRAM of the Ditto run;
- head-sheet-<mode>.png: head-only crops at Ditto's turn extremes, FlashHead | Ditto at the same frame;
- shoulder-sheet-<mode>.png: Ditto's shoulder/neck crops at the same frames (the owner's second crop);
- sbs-<mode>.mp4 (FlashHead | Ditto, full frame) and sbs-head-<mode>.mp4 (head crops zoomed), with the audio.
Clips are compared at 512 px (Ditto's 640 is downscaled) for the sheets and side-by-sides.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIDE = 512
FPS = 25
NATURAL = {"yawSd": "3-5 deg", "speed": "about 10 deg/s", "source": "Busso et al. 2007 (design.md)"}


def _label(img: Image.Image, text: str) -> Image.Image:
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 8 + 7 * len(text), 18), fill=(0, 0, 0))
    d.text((4, 3), text, fill=(235, 235, 235))
    return img


def _size(video: Path) -> tuple[int, int]:
    from ..transplant.composite import native_size

    return native_size(video)


def _metrics(videos: dict[str, Path]) -> dict:
    from ...gpu import gpu_lock
    from ...paths import portrait_path
    from ...post.metrics import measure
    from ..hands.health import check

    out: dict = {"healthBefore": check().line()}
    with gpu_lock():
        for name, v in videos.items():
            m = measure(v, portrait_path(), size=_size(v))
            out[name] = {"syncConf": m.sync_conf, "syncOffset": m.sync_offset,
                         "identity": m.identity, "faceBox": m.face_box, "notes": m.notes}
    out["healthAfter"] = check().line()
    return out


def _head_box(boxes: list, scale: float, grow: float = 0.0) -> tuple[int, int, int, int]:
    """One square box (512 space) around every frame's face box, grown to show hair and headset."""
    b = np.array([x for x in boxes if x is not None], np.float64) * scale
    x0, y0, x1, y1 = b[:, 0].min(), b[:, 1].min(), b[:, 2].max(), b[:, 3].max()
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * (0.5 + grow)
    half = min(half, SIDE / 2)
    cx, cy = min(max(cx, half), SIDE - half), min(max(cy, half), SIDE - half)
    return int(cx - half), int(cy - half), int(cx + half), int(cy + half)


def _frames_at(video: Path, picks: set[int]) -> dict[int, np.ndarray]:
    from ...ffmpeg import read_frames

    out = {}
    for i, f in enumerate(read_frames(video, (SIDE, SIDE), fps=FPS)):
        if i in picks:
            out[i] = f
        if i > max(picks):
            break
    return out


def sheets(fh: Path, dit: Path, picks: dict[str, int], head: tuple[int, int, int, int], o: Path,
           mode: str) -> dict:
    idx = set(picks.values())
    a, b = _frames_at(fh, idx), _frames_at(dit, idx)
    zoom = 384
    shoulder = (0, int(SIDE * 0.62), SIDE, SIDE)  # neck, collar and shoulders
    rows, srows = [], []
    for tag, i in picks.items():
        pair = []
        for name, frames in (("FlashHead", a), ("Ditto", b)):
            f = frames.get(i, np.zeros((SIDE, SIDE, 3), np.uint8))
            t = Image.fromarray(f).crop(head).resize((zoom, zoom), Image.LANCZOS)
            pair.append(np.asarray(_label(t, f"{name} f{i} {i / FPS:.2f}s {tag}")))
        rows.append(np.concatenate(pair, 1))
        s = Image.fromarray(b.get(i, np.zeros((SIDE, SIDE, 3), np.uint8))).crop(shoulder)
        srows.append(np.asarray(_label(s, f"Ditto shoulders f{i} {tag}")))
    grid = [np.concatenate(rows[k:k + 2], 1) if k + 1 < len(rows) else
            np.concatenate([rows[k], np.zeros_like(rows[k])], 1) for k in range(0, len(rows), 2)]
    hs, ss = o / f"head-sheet-{mode}.png", o / f"shoulder-sheet-{mode}.png"
    Image.fromarray(np.concatenate(grid, 0)).save(hs)
    Image.fromarray(np.concatenate(srows, 0)).save(ss)
    return {"headSheet": str(hs), "shoulderSheet": str(ss),
            "frames": picks, "headBox512": list(head)}


def side_by_side(fh: Path, dit: Path, wav: Path, out: Path, crop: tuple[int, int, int, int] | None) -> str:
    from ...ffmpeg import FrameWriter, read_frames

    codec = ["-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "16", "-pix_fmt",
             "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    with FrameWriter(out, (2 * SIDE, SIDE), FPS, "rgb24", codec, extra_inputs=["-i", str(wav)]) as wr:
        for fa, fb in zip(read_frames(fh, (SIDE, SIDE), fps=FPS), read_frames(dit, (SIDE, SIDE), fps=FPS)):
            pair = []
            for name, f in (("FlashHead off", fa), ("Ditto", fb)):
                img = Image.fromarray(f)
                if crop is not None:
                    img = img.crop(crop).resize((SIDE, SIDE), Image.LANCZOS)
                pair.append(np.asarray(_label(img, name)))
            wr.write(np.ascontiguousarray(np.concatenate(pair, 1)))
    return str(out)


def measure(name: str, mode: str = "offline") -> dict:
    from ...ffmpeg import read_frames
    from .ditto_cli import out_root
    from .ditto_pose import extremes, read_clip, still_change
    from .ditto_track import relative, stats
    from ..transplant.report import mux

    o = out_root() / name
    dd = o / mode
    run = json.loads((dd / "run.json").read_text(encoding="utf-8"))
    wav = Path(run["audio"])
    dit = dd / "raw.mp4"
    fh_raw = o / "fh" / "raw.mp4"
    fh = mux(fh_raw, wav, o / "fh" / "clip.mp4") if fh_raw.is_file() else None
    clips = {"ditto": dit} | ({"fh": fh} if fh else {})
    fig: dict = {"name": name, "mode": mode, "audio": str(wav), "clips": {k: str(v) for k, v in clips.items()},
                 "dittoRun": {k: run.get(k) for k in ("wallS", "vramPeakMiB", "vramBaselineMiB",
                                                      "vramDeltaMiB", "healthBefore", "healthAfter")},
                 "dittoTiming": run.get("timing"), "naturalSpeech": NATURAL}
    fig["metrics"] = _metrics(clips)
    poses = {k: read_clip(v, _size(v)) for k, v in clips.items()}
    n_aud = int(np.ceil(float((run.get("timing") or {}).get("audioS") or 1e9) * FPS - 1e-6))
    n = min(n_aud, *(len(cp.ypr) for cp in poses.values()))  # online runs end with pad frames
    fig["framesCompared"] = n
    for k, cp in poses.items():
        fig.setdefault("sharpness", {})[k] = {
            "face": round(float(np.mean(cp.face_sharp)), 1) if cp.face_sharp else None,
            "mouth": round(float(np.mean(cp.mouth_sharp)), 1) if cp.mouth_sharp else None}
        fig.setdefault("motionMediaPipe", {})[k] = stats(cp.ypr[:n])
        sz = _size(clips[k])
        band = (0, int(sz[1] * 0.75), sz[0], sz[1])
        fig.setdefault("shoulderBandChange", {})[k] = still_change(read_frames(clips[k], sz, fps=FPS), band)
    pz = np.load(dd / "pose.npz")
    fig["motionDittoTrack"] = stats(relative(pz["rendered"], pz["source"][0])[:n])
    if run.get("paced") and "frameS" in pz.files:  # frame i is due i*40 ms after the audio starts
        lat = pz["frameS"][:n] - np.arange(min(n, len(pz["frameS"]))) * 0.04
        budget = float(lat[0]) + 0.25  # first-frame latency + the live client's 250 ms jitter buffer
        fig["latencyS"] = {"first": round(float(lat[0]), 3), "p50": round(float(np.median(lat)), 3),
                           "p95": round(float(np.percentile(lat, 95)), 3), "max": round(float(lat.max()), 3),
                           "lateFrames": int((lat > budget).sum()), "budgetS": round(budget, 3)}
    dp = poses["ditto"]
    picks = extremes(dp.ypr[:n])
    fig["extremesMediaPipe"] = {k: [round(float(v), 1) for v in dp.ypr[i]] for k, i in picks.items()}
    if fh:
        head = _head_box(dp.face_boxes, SIDE / _size(dit)[0])
        fig["sheets"] = sheets(fh, dit, picks, head, o, mode)
        fig["sbs"] = side_by_side(fh, dit, wav, o / f"sbs-{mode}.mp4", None)
        fig["sbsHead"] = side_by_side(fh, dit, wav, o / f"sbs-head-{mode}.mp4", head)
    (o / f"figures-{mode}.json").write_text(json.dumps(fig, indent=2) + "\n", encoding="utf-8", newline="\n")
    return fig
