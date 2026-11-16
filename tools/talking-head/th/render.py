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
from .ffmpeg import duration_s, fps_of, probe, video_stream
from .gpu import VramSampler, gpu_lock, others_over_limit
from .paths import new_run_dir, portrait_path
from .post.alpha import write_alpha
from .post.metrics import Metrics, measure
from .post.normalise import normalise
from .schema import SCHEMA, Identity, RunRecord, Sync


def _contention(label: str, others: list[tuple[int, int]] | None, notes: list[str]) -> None:
    if others is None:
        notes.append(f"gpuExclusive unmeasurable at {label} (no per-process VRAM figure)")
    elif others:
        listed = ", ".join(f"pid {p} {mib} MiB" for p, mib in others)
        notes.append(f"other GPU processes at {label}: {listed}")


def _timed(run_log: Path, label: str, fn, /, *args, **kw):
    t = time.perf_counter()
    out = fn(*args, **kw)
    with open(run_log, "a", encoding="utf-8") as fh:
        fh.write(f"stage {label}: {time.perf_counter() - t:.1f}s\n")
    return out


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
        _contention("start", before, notes)
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
        _contention("end", after, notes)
        exclusive = None if before is None or after is None else not before and not after

        if result.video.resolve() != job.raw.resolve():
            shutil.move(str(result.video), job.raw)
        video = run_dir / "video.mp4"
        print(f"th: {arm_id} rendered in {render_s:.1f}s; normalising", file=sys.stderr)
        _timed(log, "normalise", normalise, job.raw, audio, audio_s, video, log=log)
        if alpha:
            print("th: matting (BiRefNet) -> alpha.webm", file=sys.stderr)
            _timed(log, "alpha", write_alpha, video, run_dir / "alpha.webm", log=log)
        m = Metrics()
        if metrics:
            print("th: measuring (MediaPipe, SyncNet, DINOv2)", file=sys.stderr)
            m = _timed(log, "metrics", measure, video, portrait)

    info = probe(video)
    vs = video_stream(info)
    dur = float(info["format"]["duration"])
    rec = RunRecord(
        schema=SCHEMA, arm=arm_id, script=script_id, seed=seed,
        portrait=_repo_relative(portrait), runtime=runtime,
        width=int(vs["width"]), height=int(vs["height"]), fps=round(fps_of(vs), 3),
        durationS=round(dur, 3), renderS=round(render_s, 3), rtf=round(render_s / audio_s, 4),
        ttffMs=round((first_frame[0] - t0) * 1000, 1) if first_frame else None,
        vramPeakMiB=vram.peak_delta_mib, gpuExclusive=exclusive,
        sync=Sync(conf=m.sync_conf, offsetFrames=m.sync_offset),
        identity=Identity(**m.identity), faceRoi=m.face_roi,
        weights=[*(result.weights or arm.weights()), *core_weights()],
        notes="; ".join(n for n in [result.notes, *m.notes, *notes] if n) or None,
    )
    rec.write(run_dir / "run.json")
    return run_dir


def _repo_relative(p: Path) -> str:
    from .paths import TOOL_DIR

    try:
        return p.resolve().relative_to(TOOL_DIR.parent.parent.resolve()).as_posix()
    except ValueError:
        return p.as_posix()
