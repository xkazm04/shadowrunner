"""`baseline`: today's product face. The REAL avatar player (`createAvatarPlayer`, Iris's pack) stepped
at 30 fps in headless Chromium, its mouth shaped by the studio's own lip-sync (`trackOfLine`:
analyseSpeech over the wav plus the spoken text, then `trackShaper` before every `renderFrame`,
exactly the studio Record path) and its speech level from the wav as playLine's level tap gives it.

The track is computed in the page, not ported to Python: the analyser (features, linear model,
aligner, letter table) is ~600 lines of TypeScript whose output would have to be proven equal; in
the page it IS the product code. See apps/web/bench/timeline.ts and docs/talking-head.md."""

from __future__ import annotations

from pathlib import Path

from ..schema import Weight
from .base import Arm, FrameCallback, Job, RawResult

LOOK_FRAMES = (0, 75, 150)  # written to <run>/frames/ for a look against a studio still


def spoken_text(job: Job) -> Path:
    """The words the wav speaks: `th audio`'s <script>.txt beside it (comments stripped)."""
    beside = job.audio.with_suffix(".txt")
    if beside.is_file():
        return beside
    from ..audio import paragraphs

    out = job.run_dir / "text.txt"
    out.write_text(" ".join(s for p in paragraphs(job.script_text) for s in p) + "\n", encoding="utf-8", newline="\n")
    return out


class BaselineArm(Arm):
    id = "baseline"

    def fetch(self) -> list[Weight]:
        from ..rig.capture import build_packs

        build_packs()
        return []

    def weights(self) -> list[Weight]:
        return []

    def preflight(self, runtime: str) -> None:
        super().preflight(runtime)
        from ..rig.capture import check_ready

        check_ready()

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        from ..rig.capture import SIZE, capture

        capture(job.raw, log=job.log, audio=job.audio, text=spoken_text(job), seed=job.seed,
                keep=LOOK_FRAMES, keep_dir=job.run_dir / "frames")
        return RawResult(video=job.raw, notes=(
            f"baseline: product player + studio lip-sync (analyseSpeech with text), {SIZE}px over "
            f"Iris's backdrop, player seed {job.seed}; no frame callback (ttffMs n/a)"))
