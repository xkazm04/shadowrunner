"""`python -m th.experiments.hands full`: the full (non-Flash) EchoMimicV3 arm's arguments and run
(spec iris-hands round 3, req 9). Defaults are upstream `infer_preview.Config`'s, except the
reference (`waist-c`), the gesture prompt, and one window for a line up to 137 frames."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def add_arguments(p: argparse.ArgumentParser) -> None:
    p.add_argument("--steps", type=int, default=25)
    p.add_argument("--seed", type=int, default=1116)
    p.add_argument("--audio-cfg", type=float, default=2.9, help="upstream Config default")
    p.add_argument("--text-cfg", type=float, default=4.0, help="upstream Config default")
    p.add_argument("--negative", choices=("upstream", "fingers", "none"), default="upstream")
    p.add_argument("--neg-scale", type=float, default=1.5)
    p.add_argument("--neg-steps", type=int, default=2)
    p.add_argument("--long-cfg", action="store_true", help="upstream's Long Video CFG")
    p.add_argument("--partial", type=int, default=0,
                   help="partial_video_length (0: the whole line up to 137 frames)")
    p.add_argument("--overlap", type=int, default=8, help="overlap_video_length (upstream 8)")
    p.add_argument("--no-dynamic-cfg", action="store_true")
    p.add_argument("--teacache", action="store_true")
    p.add_argument("--audio-chunk", type=int, default=0,
                   help="wav2vec features per N-frame chunk (0 = over the whole line, upstream)")
    p.add_argument("--shift", type=float, default=5.0)
    p.add_argument("--cfg-batch", action="store_true",
                   help="upstream's batch of 3 CFG branches (spills past 24 GB at 125 frames)")
    p.add_argument("--prompt", choices=("presenter", "gesture"), default="gesture")
    p.add_argument("--image", help="waist-up reference (default <out>/gen/waist-c.png)")
    p.add_argument("--wav", help="line audio (default <out>/line-short.wav)")
    p.add_argument("--name", default="full")
    p.add_argument("--out", help="output root (default var/talking-head/hands)")


def run_full(args: argparse.Namespace, root: Path, portrait: Path) -> dict:
    from ...ffmpeg import duration_s
    from . import emv3, full
    from .facebox import detect
    from .finish import finish
    from .persist import report
    from .run import run

    if not full.ready():
        raise SystemExit("hands: full-arm weights missing; run `python -m th.experiments.hands.full`")
    out = (Path(args.out) if args.out else root) / args.name
    image = Path(args.image) if args.image else root / "gen" / "waist-c.png"
    wav = Path(args.wav) if args.wav else root / "line-short.wav"
    frames = emv3.frames_for(duration_s(wav), cap=None)
    face = detect(image)
    partial = args.partial or min(frames, emv3.MAX_FRAMES)
    data = full.dataset(out / "data", image, wav, emv3.PROMPTS[args.prompt])
    cfg = full.config(data, out / "work", face, seed=args.seed, steps=args.steps,
                      text_cfg=args.text_cfg, audio_cfg=args.audio_cfg,
                      negative=full.NEGATIVES[args.negative], neg_scale=args.neg_scale,
                      neg_steps=args.neg_steps, long_cfg=args.long_cfg, partial=partial,
                      overlap=args.overlap, dynamic_cfg=not args.no_dynamic_cfg,
                      teacache=args.teacache, audio_chunk=args.audio_chunk, shift=args.shift,
                      cfg_split=not args.cfg_batch, frames=frames)
    path = full.write_config(cfg, out / "full.json")
    settings = {**cfg["config"], "frames": frames, "image": str(image), "wav": str(wav),
                "prompt": args.prompt, "negativeName": args.negative, "faceBox": list(face),
                "audioChunk": args.audio_chunk, "offload": True, "cfgSplit": not args.cfg_batch}
    full.write_driver()
    rec = run("echomimicv3-full", emv3.env(), ["python", "th_hands_full.py", str(path.resolve())],
              out, settings)
    raw = out / "raw.mp4"
    shutil.copyfile(full.output(out / "work"), raw)
    fig = finish(raw, wav, portrait, out,
                 {"renderS": rec.render_s, "vramPeakMiB": rec.vram_peak_mib, "settings": settings})
    if frames > emv3.MAX_FRAMES:   # a passage, not one window
        fig["persistence"] = report(out / "clip.mp4", emv3.window_plan(frames))
    print(json.dumps(fig, indent=2))
    return fig
