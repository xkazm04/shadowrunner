"""FlashHead Lite on the bust crop and the EchoMimicV3 clip's own audio, offline through the
realtime-fh arm's streaming driver (the same model, crop handling and chunking as live), under the
GPU lock with the driver-error count and nvidia-smi before and after (common brief)."""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from ...ffmpeg import duration_s


def render(portrait: Path, wav: Path, out_dir: Path, seed: int = 1116) -> dict:
    from ...arms.base import Job
    from ...arms.flashhead import FlashHeadArm
    from ...gpu import VramSampler, gpu_lock
    from ..hands.health import check

    arm = FlashHeadArm()
    arm.preflight("native")
    out_dir.mkdir(parents=True, exist_ok=True)
    log = out_dir / "log.txt"
    log.write_text(f"transplant fh {portrait} {wav} seed {seed}\n", encoding="utf-8", newline="\n")
    job = Job(arm=arm.id, script="transplant", script_text="", audio=wav, audio_s=duration_s(wav),
              portrait=portrait, seed=seed, runtime="native", run_dir=out_dir, log=log)
    rec: dict = {"portrait": str(portrait), "wav": str(wav), "seed": seed,
                 "started": datetime.now().isoformat(timespec="seconds"),
                 "healthBefore": check().line()}
    t0 = time.perf_counter()
    try:
        with gpu_lock(), VramSampler(1.0) as vram:
            res = arm.render_native(job, None)
        rec.update(notes=res.notes, vramPeakMiB=vram.peak, vramBaselineMiB=vram.baseline)
    except Exception as e:  # noqa: BLE001 - recorded with its time, then re-raised
        rec["error"] = f"{datetime.now().isoformat(timespec='seconds')}: {e}"
    rec["renderS"] = round(time.perf_counter() - t0, 1)
    rec["healthAfter"] = check().line()
    (out_dir / "run.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    if "error" in rec:
        raise SystemExit(f"transplant: FlashHead failed: {rec['error']}")
    return rec
