"""`noop`: the portrait held still for the length of the audio. A pipeline test, not an avatar: it
exercises normalise, alpha, metrics and board end to end, and anchors identity at ~1.0."""

from __future__ import annotations

from ..ffmpeg import run_ffmpeg
from .base import Arm, FrameCallback, Job, RawResult


class NoopArm(Arm):
    id = "noop"

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        # one looped still, muxed with the job audio; no frame callback, so ttffMs stays null
        run_ffmpeg([
            "-loop", "1", "-framerate", "30", "-i", str(job.portrait),
            "-i", str(job.audio),
            "-t", f"{job.audio_s:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
            "-tune", "stillimage", "-r", "30",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", str(job.raw),
        ], log=job.log)
        return RawResult(video=job.raw, notes="noop: the portrait repeated; pipeline test only")
