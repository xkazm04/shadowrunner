"""`uv run python -m th.experiments.transplant <command> [a|c ...]` (flashhead-live round 4, P2).

  crop a c         bust crop of hands/gen/waist-<v>.png -> <out>/<v>/bust.png (live framing)
  fh a c           FlashHead Lite on the bust crop + line-short.wav -> <out>/<v>/fh/raw.mp4 (GPU lock)
  paste a c        composite each EchoMimicV3 frame -> <out>/<v>/composite.mp4 (+ .json, .npz), CPU
  --clip-eyes      paste/measure: keep EchoMimicV3's eyes -> composite-eyes.mp4, *-eyes outputs
  measure a c      SyncNet + identity (GPU lock), jitter, sheets, side-by-side -> <out>/<v>/figures.json

Variant v reads hands/emv3-<v>8g/clip.mp4 and hands/gen/waist-<v>.png.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ...paths import main_checkout

PORTRAIT = Path("assets/characters/companions/iris/portrait.png")


def hands() -> Path:
    return main_checkout() / "var" / "talking-head" / "hands"


def out_root() -> Path:
    return main_checkout() / "var" / "talking-head" / "live-review-r4" / "p2"


def paths(v: str, tag: str = "") -> dict[str, Path]:
    o = out_root() / v
    return {"emv3": hands() / f"emv3-{v}8g" / "clip.mp4", "waist": hands() / "gen" / f"waist-{v}.png",
            "wav": hands() / "line-short.wav", "out": o, "bust": o / "bust.png",
            "fh": o / "fh" / "raw.mp4", "composite": o / f"composite{tag}.mp4"}


def _crop(v: str) -> None:
    from .crop import bust_crop

    p = paths(v)
    print(json.dumps(bust_crop(p["waist"], p["bust"]), indent=2))


def _fh(v: str) -> None:
    from .fh import render

    p = paths(v)
    print(json.dumps(render(p["bust"], p["wav"], p["fh"].parent), indent=2))


def _tag(args: argparse.Namespace) -> str:
    return "-eyes" if args.clip_eyes else ""


def _paste(v: str, args: argparse.Namespace) -> None:
    from .composite import composite
    from .mask import MaskCfg

    smooth = not args.no_smooth
    p = paths(v, _tag(args))
    out = p["composite"] if smooth else p["out"] / "composite-raw.mp4"
    rec = composite(p["emv3"], p["fh"], p["wav"], out, smooth=smooth,
                    cfg=MaskCfg(clip_eyes=args.clip_eyes))
    out.with_suffix(".json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rec, indent=2))


def _measure(v: str, args: argparse.Namespace) -> None:
    from .report import report

    print(json.dumps(report(paths(v, _tag(args)), main_checkout() / PORTRAIT, _tag(args)), indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m th.experiments.transplant")
    ap.add_argument("command", choices=("crop", "fh", "paste", "measure"))
    ap.add_argument("variants", nargs="+", choices=("a", "c"))
    ap.add_argument("--no-smooth", action="store_true", help="paste: raw per-frame fits (to compare)")
    ap.add_argument("--clip-eyes", action="store_true",
                    help="paste/measure: keep EchoMimicV3's eyes (blinks, gaze): composite-eyes.mp4")
    args = ap.parse_args()
    for v in args.variants:
        if args.command == "paste":
            _paste(v, args)
        elif args.command == "measure":
            _measure(v, args)
        else:
            {"crop": _crop, "fh": _fh}[args.command](v)


if __name__ == "__main__":
    main()
