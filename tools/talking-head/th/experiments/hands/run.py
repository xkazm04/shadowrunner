"""One heavy candidate run under the rules of the common brief: driver-error count and nvidia-smi
before and after, the GPU lock held for the measured run, VRAM sampled, wall time and a run.json
beside the outputs. A CUDA failure is recorded with its time, not retried here (the caller reruns
once by hand, as the brief says)."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Sequence

from ...arms.base import ArmEnv
from ...gpu import VramSampler, gpu_lock
from .health import check

ACCESS_VIOLATION = 3221225477   # 0xC0000005: on this machine, host commit running out mid-load
RETRIES = 2


def is_access_violation(error: str) -> bool:
    """A failed run whose process died with 0xC0000005 (printed as the unsigned exit code)."""
    return f"({ACCESS_VIOLATION})" in error


@dataclass
class RunRecord:
    candidate: str
    settings: dict
    started: str
    render_s: float | None = None
    vram_baseline_mib: int | None = None
    vram_peak_mib: int | None = None
    health_before: str = ""
    health_after: str = ""
    driver_errors_delta: int | None = None
    error: str | None = None
    notes: list[str] = field(default_factory=list)


def run(candidate: str, env: ArmEnv, argv: Sequence[str | Path], out_dir: Path, settings: dict,
        cwd: Path | None = None, extra_env: dict[str, str] | None = None) -> RunRecord:
    out_dir.mkdir(parents=True, exist_ok=True)
    rec = RunRecord(candidate, settings, datetime.now().isoformat(timespec="seconds"))
    before = check()
    rec.health_before = before.line()
    print(f"hands: before {rec.health_before}", flush=True)
    t0 = time.perf_counter()
    for attempt in range(RETRIES + 1):
        rec.error = None
        t0 = time.perf_counter()
        try:
            with gpu_lock(), VramSampler(1.0) as vram:
                env.run(argv, cwd=cwd or env.repo, log=out_dir / "log.txt",
                        env={"PYTHONIOENCODING": "utf-8", "TOKENIZERS_PARALLELISM": "false",
                             **(extra_env or {})})
            rec.vram_baseline_mib, rec.vram_peak_mib = vram.baseline, vram.peak
        except Exception as e:  # noqa: BLE001 - recorded, then re-raised after run.json is written
            rec.error = f"{datetime.now().isoformat(timespec='seconds')}: {e}"
        if rec.error and is_access_violation(rec.error) and attempt < RETRIES:
            rec.notes.append(f"attempt {attempt + 1} died with 0xC0000005 after "
                             f"{time.perf_counter() - t0:.0f} s; retried")
            print(f"hands: {rec.notes[-1]}", flush=True)
            continue
        break
    rec.render_s = round(time.perf_counter() - t0, 1)   # the successful (last) attempt
    after = check()
    rec.health_after = after.line()
    if before.driver_errors is not None and after.driver_errors is not None:
        rec.driver_errors_delta = after.driver_errors - before.driver_errors
    print(f"hands: after {rec.health_after} ({rec.render_s} s)", flush=True)
    (out_dir / "run.json").write_text(json.dumps(asdict(rec), indent=2) + "\n", encoding="utf-8")
    if rec.error:
        raise SystemExit(f"hands: {candidate} failed: {rec.error}")
    return rec
