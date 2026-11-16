"""raw.mp4 (any size, rate, with or without sound) -> video.mp4: 1080x1080, H.264 30 fps, AAC.

Letterbox/pad, never stretch. The job audio is always the soundtrack, and the picture is held on
its last frame (or cut) to the audio length, so every arm lands on the same clock."""

from __future__ import annotations

from pathlib import Path

from ..ffmpeg import run_ffmpeg

SIZE = 1080
FPS = 30


def normalise(raw: Path, audio: Path, audio_s: float, out: Path, log: Path | None = None) -> None:
    vf = (
        f"scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={SIZE}:{SIZE}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
        f"fps={FPS},tpad=stop_mode=clone:stop_duration=10"
    )
    run_ffmpeg([
        "-i", str(raw), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-t", f"{audio_s:.3f}", str(out),
    ], log=log)
