"""`uv run python -m th.experiments.head3d.ditto_cli <command>` (flashhead-live round 5, H2: Ditto).

  setup                         clone, env $TH_HOME/envs/head3d-ditto, weights (no InsightFace)
  setup-docker                  image th-head3d-ditto:trt861 + upstream's TensorRT engines (no InsightFace)
  render NAME --audio WAV       Ditto on Iris's bust under the GPU lock -> <out>/NAME/<mode>/
         [--mode offline|online] [--paced] [--runtime native|docker] [--track TRACK [--frames N]]
                                --track also writes $TH_HOME/head3d/tracks/TRACK.npz (N: pad/trim)
  silence SECONDS WAV           write a 24 kHz silent wav (the idle input)
  fh NAME --audio WAV           FlashHead `off` (plain, the realtime-fh arm) on the same bust + wav
  measure NAME [--mode DIR]     Ditto (run dir DIR, e.g. online-paced) vs FlashHead on NAME:
                                metrics, motion, sheets, side-by-side

<out> = <main checkout>/var/talking-head/live-review-r5/h2.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path

import numpy as np

from ...paths import main_checkout, th_home

HERE = Path(__file__).resolve().parent


def out_root() -> Path:
    return main_checkout() / "var" / "talking-head" / "live-review-r5" / "h2"


def bust() -> Path:
    return th_home() / "live" / "iris-bust.png"


def tracks_dir() -> Path:
    return th_home() / "head3d" / "tracks"


def settle(timeout_s: float = 20.0) -> int | None:
    """Wait until used VRAM stops falling (2 s apart), so the baseline is not another job's tail."""
    from ...gpu import memory_used_mib

    prev, t_end = memory_used_mib(), time.monotonic() + timeout_s
    while time.monotonic() < t_end:
        time.sleep(2.0)
        cur = memory_used_mib()
        if prev is None or cur is None or cur >= prev - 64:
            return cur
        prev = cur
    return prev


def render(name: str, audio: Path, mode: str = "offline", paced: bool = False,
           runtime: str = "native") -> dict:
    from ...gpu import VramSampler, gpu_lock
    from ..hands.health import check
    from . import ditto_env as de

    if de.missing():
        raise SystemExit(f"ditto: weights missing {de.missing()}; run `ditto_cli setup`")
    out = out_root() / name / (mode + ("-paced" if paced else "") + ("-trt" if runtime == "docker" else ""))
    out.mkdir(parents=True, exist_ok=True)
    data, cfg = de.data_root(), de.cfg_path()
    if runtime == "docker":
        from . import ditto_docker as dd

        data, cfg = dd.trt_cfg_path().parent.parent / "ditto_trt_Ampere_Plus", dd.trt_cfg_path()
    args = ["--data-root", str(data), "--cfg", str(cfg), "--task", str(de.task_path()), "--audio",
            str(audio), "--source", str(bust()), "--out", str(out), "--mode", mode] + (["--paced"] if paced else [])
    cmd = [str(de.env_python()), str(HERE / "ditto_run.py"), *args]
    if runtime == "docker":
        cmd = dd.run_cmd(args, audio, out, HERE, de.repo_dir())
    rec: dict = {"name": name, "audio": str(audio), "source": str(bust()), "mode": mode, "paced": paced,
                 "runtime": runtime,
                 "started": datetime.now().isoformat(timespec="seconds")}
    with gpu_lock():
        rec["vramSettledMiB"] = settle()  # the previous holder's process may still be exiting
        rec["healthBefore"] = check().line()
        t0 = time.perf_counter()
        with VramSampler(0.25) as vram:
            with open(out / "log.txt", "w", encoding="utf-8", newline="\n") as log:
                proc = subprocess.run(cmd, cwd=de.repo_dir(), stdout=log, stderr=subprocess.STDOUT)
    rec.update(wallS=round(time.perf_counter() - t0, 1), vramPeakMiB=vram.peak,
               vramBaselineMiB=vram.baseline, vramDeltaMiB=vram.peak_delta_mib,
               healthAfter=check().line(), exit=proc.returncode)
    if proc.returncode == 0:
        rec["timing"] = json.loads((out / "timing.json").read_text(encoding="utf-8"))
    (out / "run.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8", newline="\n")
    if proc.returncode != 0:
        raise SystemExit(f"ditto: runner failed ({proc.returncode}); see {out / 'log.txt'}")
    rec["out"] = str(out)
    return rec


def track(name_dir: Path, audio: Path, track_name: str, frames: int | None) -> dict:
    from .ditto_track import export

    if frames is None:
        import soundfile as sf

        info = sf.info(str(audio))
        frames = int(np.ceil(info.frames / info.samplerate * 25 - 1e-9))
    rec = export(name_dir / "pose.npz", audio, tracks_dir() / f"{track_name}.npz", frames)
    (name_dir / f"track-{track_name}.json").write_text(json.dumps(rec, indent=2) + "\n",
                                                       encoding="utf-8", newline="\n")
    return rec


def silence(seconds: float, wav: Path, sr: int = 24000) -> Path:
    import soundfile as sf

    wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(wav), np.zeros(int(round(seconds * sr)), np.int16), sr, subtype="PCM_16")
    return wav


def fh(name: str, audio: Path) -> dict:
    from ..transplant.fh import render as fh_render

    return fh_render(bust(), audio, out_root() / name / "fh")


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m th.experiments.head3d.ditto_cli")
    ap.add_argument("command", choices=("setup", "setup-docker", "render", "silence", "fh",
                                            "measure"))
    ap.add_argument("args", nargs="*")
    ap.add_argument("--audio", type=Path)
    ap.add_argument("--mode", default="offline",
                    help="render: offline | online; measure: the run dir name (e.g. online-paced)")
    ap.add_argument("--paced", action="store_true")
    ap.add_argument("--runtime", choices=("native", "docker"), default="native",
                    help="docker: upstream's TensorRT 8.6.1 engines in th-head3d-ditto:trt861")
    ap.add_argument("--track")
    ap.add_argument("--frames", type=int)
    a = ap.parse_args()
    if a.command == "setup":
        from .ditto_env import setup

        res = setup()
    elif a.command == "setup-docker":
        from . import ditto_docker as dd
        from .ditto_env import NAME, licences

        from ...arms.base import write_licences
        from ...paths import models_dir

        res = {"image": dd.build(), "engines": dd.fetch_engines()}
        write_licences(models_dir(NAME), licences())
    elif a.command == "silence":
        res = {"wav": str(silence(float(a.args[0]), Path(a.args[1])))}
    elif a.command == "render":
        if a.mode not in ("offline", "online"):
            raise SystemExit("ditto: render --mode is offline or online")
        res = render(a.args[0], a.audio, a.mode, a.paced, a.runtime)
        if a.track:
            res["track"] = track(Path(res["out"]), a.audio, a.track, a.frames)
    elif a.command == "fh":
        res = fh(a.args[0], a.audio)
    else:
        from .ditto_measure import measure

        res = measure(a.args[0], a.mode)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
