"""Post-only dub-ls variant: a new run dir from an existing dub-ls run's outputs, with the paste
mode of TH_DUB_PASTE (th/rig/dub_paste.py) and no new LatentSync render. Then it runs normalise,
the metrics and alpha, and writes a run.json whose renderS is the source arm's plus the paste's.

  uv run python -m th.rig.dub_repost <source run dir> [--metrics cpu|cuda] [--alpha lock|none]
                                     [--keep 6.2,15.32,33.48] [--into <run dir>]

- `--metrics cpu` (the default) runs MediaPipe, DINOv2 and SyncNet on the CPU, with no GPU lock.
- `--alpha lock` runs BiRefNet on the GPU under the GPU lock, after run.json is written. On the CPU
  it measured minutes per handful of frames, so CPU is not offered.
- `--keep` takes seconds: those composite frames are saved with the mask edge drawn.
- `--into` resumes a run dir this tool made: an existing raw.mp4 and video.mp4 are kept.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

from ..ffmpeg import duration_s, fps_of, probe, video_stream
from ..paths import TOOL_DIR, audio_dir, new_run_dir
from ..schema import Identity, RunRecord, Sync, load_run
from . import dub_paste


def _stage(logfile: Path, label: str, fn, /, *a, **kw):
    t = time.perf_counter()
    out = fn(*a, **kw)
    with open(logfile, "a", encoding="utf-8") as fh:
        fh.write(f"stage {label}: {time.perf_counter() - t:.1f}s\n")
    return out


def _paste(src: Path, run: Path, log: Path, keep_s: tuple[float, ...]) -> dict:
    mode = dub_paste.mode()
    for name in ("plate.mp4", "plate25.mp4", "alignment-sheet.png"):
        if (src / name).is_file():
            shutil.copy2(src / name, run / name)
    shutil.copy2(src / "raw.mp4", run / "ls-raw.mp4")
    keep_dir = run / "frames"
    keep_dir.mkdir(exist_ok=True)
    keep = {int(round(t * 25)): keep_dir / f"paste-{t:06.2f}s.png" for t in keep_s}
    if mode == "mouth":
        stats = _stage(log, "paste", dub_paste.composite, run / "plate25.mp4", run / "ls-raw.mp4",
                       run / "raw.mp4", log=log, keep=keep)
    else:
        shutil.copy2(run / "ls-raw.mp4", run / "raw.mp4")
        stats = {"frames": None, "missed": 0, "seconds": 0.0}
    stats = {"source": src.name, "mode": mode, **stats, "jawPadPx": dub_paste.JAW_PAD_PX,
             "featherPx": dub_paste.FEATHER_PX}
    (run / "paste.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8", newline="\n")
    return stats


def repost(src: Path, metrics_device: str = "cpu", alpha: str = "lock", keep_s: tuple[float, ...] = (),
           into: Path | None = None) -> Path:
    rec = load_run(src / "run.json")
    if rec.arm != "dub-ls":
        raise SystemExit(f"dub_repost: {src} is a {rec.arm} run")
    if not (src / "plate25.mp4").is_file():
        raise SystemExit(f"dub_repost: {src / 'plate25.mp4'} is missing (LatentSync's own 25 fps plate)")
    run = into or new_run_dir("dub-ls", rec.script)
    log = run / "log.txt"
    with open(log, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(f"dub_repost {src.name} TH_DUB_PASTE={dub_paste.mode()} metrics={metrics_device} alpha={alpha}\n")
    from ..post.metrics import measure
    from ..post.normalise import normalise

    audio = audio_dir() / f"{rec.script}.wav"
    audio_s = duration_s(audio)
    video = run / "video.mp4"
    if into is not None and (run / "paste.json").is_file() and video.is_file():
        stats = json.loads((run / "paste.json").read_text(encoding="utf-8"))
    else:
        stats = _paste(src, run, log, keep_s)
        _stage(log, "normalise", normalise, run / "raw.mp4", audio, audio_s, video, log=log)
    m = _stage(log, "metrics", measure, video, TOOL_DIR.parent.parent / rec.portrait, device=metrics_device)

    vs = video_stream(probe(video))
    render_s = (rec.renderS or 0.0) + float(stats["seconds"])
    RunRecord(
        schema=rec.schema_, arm="dub-ls", script=rec.script, seed=rec.seed, portrait=rec.portrait,
        runtime=rec.runtime, width=int(vs["width"]), height=int(vs["height"]), fps=round(fps_of(vs), 3),
        durationS=round(float(probe(video)["format"]["duration"]), 3), renderS=round(render_s, 3),
        rtf=round(render_s / audio_s, 4), ttffMs=None, vramPeakMiB=rec.vramPeakMiB,
        gpuExclusive=rec.gpuExclusive, sync=Sync(conf=m.sync_conf, offsetFrames=m.sync_offset),
        identity=Identity(**m.identity), faceRoi=m.face_roi, weights=rec.weights,
        notes="; ".join(n for n in [
            rec.notes, f"v2: post-only paste TH_DUB_PASTE={stats['mode']} of {src.name} (no new LatentSync "
            f"render; renderS = its arm {rec.renderS}s + paste {stats['seconds']}s on CPU, {stats['missed']} "
            f"frames without landmarks); metrics on {metrics_device}", *m.notes] if n),
    ).write(run / "run.json")
    if alpha == "lock":
        from ..gpu import gpu_lock
        from ..post.alpha import write_alpha

        with gpu_lock():
            _stage(log, "alpha", write_alpha, video, run / "alpha.webm", log=log)
    return run


def main() -> None:
    p = argparse.ArgumentParser(prog="th.rig.dub_repost")
    p.add_argument("source", type=Path)
    p.add_argument("--metrics", default="cpu", choices=("cpu", "cuda"))
    p.add_argument("--alpha", default="lock", choices=("lock", "none"))
    p.add_argument("--keep", default="")
    p.add_argument("--into", type=Path, default=None)
    a = p.parse_args()
    keep = tuple(float(t) for t in a.keep.split(",") if t)
    print(repost(a.source, a.metrics, a.alpha, keep, a.into))


if __name__ == "__main__":
    main()
