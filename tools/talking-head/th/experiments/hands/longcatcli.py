"""`python -m th.experiments.hands longcat`: LongCat-Video-Avatar 1.6 on the waist-up image, then the
same finish (SyncNet, identity, hand check) and, for a passage, gesture persistence. INTERNAL
COMPARISON ONLY: the output folder gets INTERNAL-ONLY.txt and figures.json `internalOnly: true`."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def add_arguments(p: argparse.ArgumentParser) -> None:
    p.add_argument("--seed", type=int, default=42, help="upstream's fixed seed is 42")
    p.add_argument("--mix-steps", type=int, default=4)
    p.add_argument("--mix-alpha", type=float, default=1.0)
    p.add_argument("--prompt", choices=("presenter", "gesture"), default="gesture")
    p.add_argument("--image", help="waist-up reference (default <out>/gen/waist-c.png)")
    p.add_argument("--wav", help="line audio (default <out>/line-short.wav)")
    p.add_argument("--name", default="longcat")
    p.add_argument("--out", help="output root (default var/talking-head/hands)")


def run_longcat(args: argparse.Namespace, root: Path, portrait: Path) -> dict:
    from ...ffmpeg import duration_s
    from . import emv3, longcat
    from .finish import finish
    from .persist import report
    from .run import run

    out = (Path(args.out) if args.out else root) / args.name
    out.mkdir(parents=True, exist_ok=True)
    (out / "INTERNAL-ONLY.txt").write_text(longcat.INTERNAL["internalNote"] + "\n", encoding="utf-8")
    image = Path(args.image) if args.image else root / "gen" / "waist-c.png"
    wav = Path(args.wav) if args.wav else root / "line-short.wav"
    frames = emv3.frames_for(duration_s(wav), cap=None)
    segments = longcat.segments_for(frames)
    spec = {"prompt": emv3.PROMPTS[args.prompt], "cond_image": str(image.resolve()),
            "cond_audio": {"person1": str(wav.resolve())}}
    (out / "input.json").write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8")
    settings = {"seed": args.seed, "segments": segments, "frames": frames, "image": str(image),
                "wav": str(wav), "prompt": args.prompt, "mixSteps": args.mix_steps,
                "mixAlpha": args.mix_alpha, "int8": True, "distill": True, "resolution": "480p",
                **longcat.INTERNAL}
    longcat.write_driver()
    argv = longcat.command((out / "input.json").resolve(), (out / "work").resolve(), segments,
                           args.mix_steps, args.mix_alpha)
    rec = run("longcat-video-avatar-1.6", longcat.env(), argv, out, settings,
              extra_env={"TH_LC_SEED": str(args.seed)})
    raw = out / "raw.mp4"
    shutil.copyfile(longcat.output(out / "work", segments), raw)
    fig = finish(raw, wav, portrait, out, {"renderS": rec.render_s, "vramPeakMiB": rec.vram_peak_mib,
                                           "settings": settings, **longcat.INTERNAL})
    if frames > emv3.MAX_FRAMES:   # a passage, not one window
        fig["persistence"] = report(out / "clip.mp4", emv3.window_plan(frames))
    print(json.dumps(fig, indent=2))
    return fig
