"""`th render`: GPU lock -> arm -> normalise -> alpha -> metrics -> run.json."""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

import numpy as np

from .arms import get_arm
from .arms.base import ArmNotBuilt, Job
from .audio import read_script, render_audio
from .fetch import core_weights
from .ffmpeg import duration_s, probe
from .gpu import VramSampler, gpu_lock, others_over_limit
from .paths import new_run_dir, portrait_path
from .post.alpha import write_alpha
from .post.metrics import Metrics, measure
from .post.normalise import normalise
from .record import (
    Provenance, Timing, build_record, contention_notes, gpu_exclusive, join_notes, repo_relative, stage,
)


def render(arm_id: str, script_id: str, seed: int = 1116, runtime: str = "native",
           portrait: Path | None = None, alpha: bool = True, metrics: bool = True) -> Path:
    arm = get_arm(arm_id)
    try:
        arm.preflight(runtime)
    except ArmNotBuilt as e:
        raise SystemExit(f"th render: {e}") from None
    portrait = portrait or portrait_path()
    audio = render_audio(script_id)
    audio_s = duration_s(audio)
    run_dir = new_run_dir(arm_id, script_id)
    log = run_dir / "log.txt"
    log.write_text(f"th render --arm {arm_id} --script {script_id} --seed {seed} --runtime {runtime}\n",
                   encoding="utf-8", newline="\n")
    job = Job(arm=arm_id, script=script_id, script_text=read_script(script_id), audio=audio,
              audio_s=audio_s, portrait=portrait, seed=seed, runtime=runtime, run_dir=run_dir, log=log)
    notes: list[str] = []
    first_frame: list[float] = []

    def on_frame(_frame: np.ndarray) -> None:
        if not first_frame:
            first_frame.append(time.perf_counter())

    with gpu_lock():
        before = others_over_limit()
        notes += contention_notes("start", before)
        t0 = time.perf_counter()
        try:
            with VramSampler() as vram:
                result = arm.render(job, on_frame)
        except ArmNotBuilt as e:
            shutil.rmtree(run_dir, ignore_errors=True)
            raise SystemExit(f"th render: {e}") from None
        except Exception as e:
            with open(log, "a", encoding="utf-8") as fh:
                fh.write(f"arm failed: {e!r}\n")
            raise SystemExit(f"th render: {arm_id} failed: {e} (log: {log})") from None
        render_s = time.perf_counter() - t0
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(f"stage arm: {render_s:.1f}s\n")
        after = others_over_limit()
        notes += contention_notes("end", after)
        exclusive = gpu_exclusive(before, after)

        if result.video.resolve() != job.raw.resolve():
            shutil.move(str(result.video), job.raw)
        video = run_dir / "video.mp4"
        print(f"th: {arm_id} rendered in {render_s:.1f}s; normalising", file=sys.stderr)
        stage(log, "normalise", normalise, job.raw, audio, audio_s, video, log=log)
        if alpha:
            print("th: matting (BiRefNet) -> alpha.webm", file=sys.stderr)
            stage(log, "alpha", write_alpha, video, run_dir / "alpha.webm", log=log)
        m = Metrics()
        if metrics:
            print("th: measuring (MediaPipe, SyncNet, DINOv2)", file=sys.stderr)
            m = stage(log, "metrics", measure, video, portrait)

    rec = build_record(
        probe=probe(video), metrics=m,
        timing=Timing(render_s=render_s, audio_s=audio_s,
                      ttff_ms=round((first_frame[0] - t0) * 1000, 1) if first_frame else None,
                      vram_peak_mib=vram.peak_delta_mib),
        provenance=Provenance(arm=arm_id, script=script_id, seed=seed, portrait=repo_relative(portrait),
                              runtime=runtime),
        weights=[*(result.weights or arm.weights()), *core_weights()],
        notes=join_notes([result.notes, *m.notes, *notes]), gpu_exclusive=exclusive,
    )
    rec.write(run_dir / "run.json")
    return run_dir
