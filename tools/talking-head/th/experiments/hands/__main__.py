"""`uv run python -m th.experiments.hands <command>` (spec `iris-hands`).

  image <variant.png>...           identity of each waist-up variant vs Iris's portrait (JSON)
  line [--text T] [--file F]       speak the test line into <out>/line.wav (Kokoro, Iris's voice)
  health                           nvlddmkm events in the last 30 min + nvidia-smi
  check <clip.mp4>...              hand check: score, worst 0.5 s, flagged-frame sheets
  seams <clip.mp4>                 a --long take's joins: frame and face step, per-window SyncNet
  finish <raw.mp4> <name>          clip.mp4 (with line.wav), sheet.png, figures.json in <out>/<name>
  sa [--kind rec-vec|square] ...   StableAvatar-1.3B at 480x832 on the waist-up image, then finish
  emv3 [--steps 8] ...             EchoMimicV3-Flash (offloaded components) on it, then finish
                                   (levers: --seed --audio-cfg --negative --no-teacache --shift;
                                   --long renders a 15-20 s line in continued windows;
                                   round 3: --beats per-window prompts, --pose <png> a fresh
                                   CLIP reference for every window after the first)
  full [--steps 25] ...            full (non-Flash) EchoMimicV3, MediaPipe face mask, then finish
                                   (levers: --negative --neg-scale --neg-steps --long-cfg ...)
  pose <clip.mp4> <out.png>        the open-hands frame of a take (for emv3 --pose)
  persist <clip.mp4>...            gesture persistence per window, into figures.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from ...paths import main_checkout

PORTRAIT = Path("assets/characters/companions/iris/portrait.png")


def out_root() -> Path:
    return main_checkout() / "var" / "talking-head" / "hands"


def _image(args: argparse.Namespace) -> None:
    from .image import score

    rows = score(main_checkout() / PORTRAIT, [Path(p) for p in args.variants])
    print(json.dumps([{**asdict(r), "path": str(r.path)} for r in rows], indent=2))


def _line(args: argparse.Namespace) -> None:
    from .audio import LINE, speak

    out = out_root() / args.file
    print(f"{out}: {speak(args.text or LINE, out):.2f} s")


def _health(_: argparse.Namespace) -> None:
    from .health import check

    print(check().line())


def _finish(args: argparse.Namespace) -> None:
    from .finish import finish

    wav = Path(args.wav) if args.wav else out_root() / "line.wav"
    fig = finish(Path(args.raw), wav, main_checkout() / PORTRAIT, out_root() / args.name)
    print(json.dumps(fig, indent=2))


def _check(args: argparse.Namespace) -> None:
    from .handsheet import report

    rows = {}
    for c in args.clips:
        clip = Path(c)
        r = report(clip, clip.parent)
        rows[str(clip)] = {k: r[k] for k in ("handScore", "handWorst", "handWorstAt", "flagKinds")}
        fig = clip.parent / "figures.json"
        if fig.is_file():  # keep a finished take's figures in step with a re-run check
            f = json.loads(fig.read_text(encoding="utf-8"))
            fig.write_text(json.dumps({**f, **rows[str(clip)]}, indent=2) + chr(10), encoding="utf-8")
    print(json.dumps(rows, indent=2))


def _seams(args: argparse.Namespace) -> None:
    from . import emv3
    from .seam import report

    clip = Path(args.clip)
    st = json.loads((clip.parent / "figures.json").read_text(encoding="utf-8"))["settings"]
    plan = emv3.window_plan(st["frames"], st["window"], st["overlap"])
    print(json.dumps(report(clip, main_checkout() / PORTRAIT, plan, st["overlap"], clip.parent),
                     indent=2))


def _sa(args: argparse.Namespace) -> None:
    import shutil

    from . import stableavatar as sa
    from .finish import finish
    from .frame import fit
    from .run import run

    out = out_root() / args.name
    work = out / "work"
    image = Path(args.image) if args.image else out_root() / "gen" / "waist-a.png"
    ref = fit(image, sa.SIZE, out / "reference.png")
    wav = Path(args.wav) if args.wav else out_root() / "line.wav"
    settings = {"kind": args.kind, "steps": args.steps, "memory": args.memory, "seed": args.seed,
                "size": list(sa.SIZE), "image": str(image)}
    argv = sa.command(ref, wav, work, args.seed, args.steps, args.memory, args.kind)
    rec = run("stableavatar", sa.env(), argv, out, settings)
    raw = out / "raw.mp4"
    shutil.move(str(sa.output(work)), raw)
    fig = finish(raw, wav, main_checkout() / PORTRAIT, out,
                 {"renderS": rec.render_s, "vramPeakMiB": rec.vram_peak_mib, "settings": settings})
    print(json.dumps(fig, indent=2))


def _emv3(args: argparse.Namespace) -> None:
    import shutil

    from ...ffmpeg import duration_s
    from . import emv3
    from .finish import finish
    from .run import run

    out = (Path(args.out) if args.out else out_root()) / args.name
    work = out / "work"
    image = Path(args.image) if args.image else out_root() / "gen" / "waist-a.png"
    out.mkdir(parents=True, exist_ok=True)
    ref = out / f"reference{image.suffix}"
    shutil.copyfile(image, ref)
    wav = Path(args.wav) if args.wav else out_root() / "line-short.wav"
    window = emv3.WINDOW if args.long else 0
    frames = emv3.frames_for(duration_s(wav), cap=None if args.long else emv3.MAX_FRAMES)
    reanchor = None
    if args.beats or args.pose:
        from . import reanchor as ra

        reanchor = ra.write(out / "reanchor.json", ra.beat_prompts() if args.beats else None,
                            ["", str(Path(args.pose).resolve())] if args.pose else None)
    settings = {"steps": args.steps, "frames": frames, "seed": args.seed, "audioCfg": args.audio_cfg,
                "textCfg": args.text_cfg, "offload": not args.full_load, "image": str(image),
                "wav": str(wav), "sampleArea": list(emv3.SAMPLE_AREA), "prompt": args.prompt,
                "negative": args.negative, "teacache": not args.no_teacache, "shift": args.shift,
                "window": window, "overlap": args.overlap if window else 0,
                "audioChunk": args.audio_chunk, "beats": args.beats, "pose": args.pose}
    emv3.write_driver()
    argv = emv3.command(ref, wav, work, args.seed, args.steps, frames, args.audio_cfg, args.text_cfg,
                        emv3.PROMPTS[args.prompt], emv3.NEGATIVES[args.negative], args.shift)
    rec = run("echomimicv3-flash", emv3.env(), argv, out, settings,
              extra_env=emv3.driver_env(not args.full_load, not args.no_teacache, window, args.overlap,
                                        args.audio_chunk, reanchor))
    raw = out / "raw.mp4"
    shutil.move(str(emv3.output(work, ref)), raw)
    fig = finish(raw, wav, main_checkout() / PORTRAIT, out,
                 {"renderS": rec.render_s, "vramPeakMiB": rec.vram_peak_mib, "settings": settings})
    if window:
        from .seam import report

        plan = emv3.window_plan(frames, window, args.overlap)
        fig["seams"] = report(out / "clip.mp4", main_checkout() / PORTRAIT, plan, args.overlap, out)
        fig["persistence"] = _persist_clip(out / "clip.mp4", plan)
    print(json.dumps(fig, indent=2))


def _persist_clip(clip: Path, plan: list[tuple[int, int]], write: bool = True) -> dict:
    from .persist import report

    return report(clip, plan, write)


def _persist(args: argparse.Namespace) -> None:
    from . import emv3

    rows = {}
    for c in args.clips:
        clip = Path(c)
        st = json.loads((clip.parent / "figures.json").read_text(encoding="utf-8"))
        rows[str(clip)] = _persist_clip(clip, emv3.window_plan(st["frames"]), not args.dry)
    print(json.dumps(rows, indent=2))


def _pose(args: argparse.Namespace) -> None:
    from .reanchor import extract_pose

    out, i = extract_pose(Path(args.clip), Path(args.out))
    print(f"{out}: frame {i}")


def _full(args: argparse.Namespace) -> None:
    from .fullcli import run_full

    run_full(args, out_root(), main_checkout() / PORTRAIT)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m th.experiments.hands")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("image", help="identity of waist-up variants vs the portrait")
    p.add_argument("variants", nargs="+")
    p.set_defaults(fn=_image)
    p = sub.add_parser("line", help="speak the test line")
    p.add_argument("--text")
    p.add_argument("--file", default="line.wav", help="e.g. line-short.wav for the first sentence")
    p.set_defaults(fn=_line)
    p = sub.add_parser("health", help="driver error count and GPU memory")
    p.set_defaults(fn=_health)
    p = sub.add_parser("finish", help="mux, measure and sheet a candidate's raw video")
    p.add_argument("raw")
    p.add_argument("name")
    p.add_argument("--wav", help="audio to mux (default <out>/line.wav)")
    p.set_defaults(fn=_finish)
    p = sub.add_parser("check", help="per-frame hand check: hands.json + sheets beside each clip")
    p.add_argument("clips", nargs="+")
    p.set_defaults(fn=_check)
    p = sub.add_parser("seams", help="seams of a --long take: frame/face step at each join")
    p.add_argument("clip")
    p.set_defaults(fn=_seams)
    p = sub.add_parser("sa", help="StableAvatar-1.3B candidate")
    p.add_argument("--kind", choices=("rec-vec", "square"), default="rec-vec")
    p.add_argument("--steps", type=int, default=50)
    p.add_argument("--memory", default="model_cpu_offload")
    p.add_argument("--seed", type=int, default=1116)
    p.add_argument("--image", help="waist-up reference (default <out>/gen/waist-a.png)")
    p.add_argument("--name", default="sa")
    p.add_argument("--wav", help="line audio (default <out>/line.wav)")
    p.set_defaults(fn=_sa)
    p = sub.add_parser("emv3", help="EchoMimicV3-Flash candidate")
    p.add_argument("--steps", type=int, default=8)
    p.add_argument("--seed", type=int, default=1116)
    p.add_argument("--audio-cfg", type=float, default=3.0)
    p.add_argument("--text-cfg", type=float, default=6.0)
    p.add_argument("--full-load", action="store_true", help="upstream's whole-pipeline-on-GPU")
    p.add_argument("--prompt", choices=("presenter", "gesture"), default="presenter")
    p.add_argument("--image", help="waist-up reference (default <out>/gen/waist-a.png)")
    p.add_argument("--wav", help="line audio (default <out>/line-short.wav, within 137 frames)")
    p.add_argument("--name", default="emv3")
    p.add_argument("--out", help="output root (default var/talking-head/hands)")
    p.add_argument("--negative", choices=("upstream", "fingers"), default="upstream")
    p.add_argument("--no-teacache", action="store_true", help="render every step in full")
    p.add_argument("--shift", type=float, default=5.0)
    p.add_argument("--long", action="store_true",
                   help="whole line in windows with motion-frame continuation")
    p.add_argument("--overlap", type=int, default=9, help="motion frames carried over (4k + 1)")
    p.add_argument("--audio-chunk", type=int, default=0,
                   help="wav2vec features per N-frame chunk (0 = over the whole line, upstream)")
    p.add_argument("--beats", action="store_true", help="--long: one beat prompt per window")
    p.add_argument("--pose", help="--long: CLIP reference image for every window after the first")
    p.set_defaults(fn=_emv3)
    p = sub.add_parser("full", help="full (non-Flash) EchoMimicV3 candidate")
    from .fullcli import add_arguments

    add_arguments(p)
    p.set_defaults(fn=_full)
    p = sub.add_parser("pose", help="the open-hands frame of a take")
    p.add_argument("clip")
    p.add_argument("out")
    p.set_defaults(fn=_pose)
    p = sub.add_parser("persist", help="gesture persistence per window (passage takes)")
    p.add_argument("clips", nargs="+")
    p.add_argument("--dry", action="store_true", help="print only (leave figures.json alone)")
    p.set_defaults(fn=_persist)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main(sys.argv[1:])
