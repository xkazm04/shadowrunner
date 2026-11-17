"""A candidate's raw video -> clip.mp4 (H.264 + the line's audio, cut to the shorter), sheet.png and
figures.json (SyncNet, identity, hand and head statistics)."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from ...ffmpeg import duration_s, run_ffmpeg
from ...post.metrics import audio_16k, measure
from .measure import motion_stats, native_size, sheet


def mux(video: Path, wav: Path, out: Path, fps: int = 25) -> Path:
    """Re-encode at `fps` (CRF 16) with the wav as AAC; the shorter stream sets the length."""
    run_ffmpeg(["-i", str(video), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0",
                "-vf", f"fps={fps}", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)])
    return out


def finish(raw: Path, wav: Path, portrait: Path, out_dir: Path, extra: dict | None = None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    clip = mux(raw, wav, out_dir / "clip.mp4")
    size = native_size(clip)
    m = measure(clip, portrait, size=size)
    stats = motion_stats(clip, audio_16k(clip))
    sheet(clip, out_dir / "sheet.png")
    fig = {
        "clip": str(clip), "size": list(size), "seconds": round(duration_s(clip), 3),
        "syncConf": m.sync_conf, "syncOffset": m.sync_offset, "identity": m.identity,
        "faceBox": m.face_box, "notes": m.notes, **asdict(stats), **(extra or {}),
    }
    (out_dir / "figures.json").write_text(json.dumps(fig, indent=2) + "\n", encoding="utf-8")
    return fig
