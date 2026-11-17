"""`th`: fetch weights, voice a script, render an arm, build a blind board."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .schema import ARM_IDS


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="th", description="talking-head: alternative avatar arms on the local GPU "
                                "(spec .kiro/specs/talking-head, docs/talking-head.md).")
    sub = p.add_subparsers(dest="cmd", required=True, metavar="{fetch,audio,render,board,live,live-bench}")

    f = sub.add_parser("fetch", help="download weights into $TH_HOME/models/<name>/ with licence.json")
    f.add_argument("target", help="metrics (all post-processing models), birefnet, dinov2, mediapipe, "
                   f"syncnet, or an arm: {', '.join(ARM_IDS)}")
    f.add_argument("--force", action="store_true", help="download again even if present")

    a = sub.add_parser("audio", help="voice a script with Kokoro into $TH_HOME/audio/<script>.wav")
    a.add_argument("--script", required=True, help="a script id from tools/talking-head/scripts/")
    a.add_argument("--force", action="store_true", help="synthesise again even if the wav is current")

    r = sub.add_parser("render", help="render one arm for one script into a run dir")
    r.add_argument("--arm", required=True, choices=ARM_IDS)
    r.add_argument("--script", required=True)
    r.add_argument("--seed", type=int, default=1116)
    r.add_argument("--runtime", choices=("native", "docker"), default="native")
    r.add_argument("--portrait", type=Path, default=None, help="default: Iris")
    r.add_argument("--no-alpha", action="store_true", help="skip BiRefNet (alpha.webm not written)")
    r.add_argument("--no-metrics", action="store_true", help="skip SyncNet/identity (nulls in run.json)")

    b = sub.add_parser("board", help="blind 3x2 board of up to six runs; `th board reveal` unblinds the "
                       "filled verdict.md")
    b.add_argument("action", nargs="?", choices=("build", "reveal"), default="build",
                   help="build (default) or reveal (verdict.md + key.json + run.json -> reveal.md/json)")
    b.add_argument("--runs", default=None, help="build: comma-separated run dirs (the first one's audio plays)")
    b.add_argument("--seed", type=int, default=1116)
    b.add_argument("--out", type=Path, required=True, help="the board dir")

    from .live.upscale import KINDS

    lv = sub.add_parser("live", help="live Iris: the fhl/1 server (FlashHead Lite) on ws://127.0.0.1:<port>/live; "
                        "`th live make-idle` renders her idle loop")
    lv.add_argument("action", nargs="?", choices=("serve", "make-idle"), default="serve",
                    help="serve (default) or make-idle (render the idle loop offline)")
    lv.add_argument("--port", type=int, default=8765)
    lv.add_argument("--upscale", choices=KINDS, default="maxine",
                    help="maxine (default; falls back to none, with an error event, if it cannot load)")
    lv.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                    help="also accept this browser origin (repeatable); localhost/127.0.0.1 always pass")
    lv.add_argument("--fake", action="store_true", help="synthetic face and voice, no GPU (UI work)")
    lv.add_argument("--matte", action="store_true", help="start with matting on (TH_LIVE_MATTE kind, "
                    "default birefnet-lite-matting): frames go out as 0x04 colour + alpha")
    lv.add_argument("--no-idle-loop", action="store_true", help="show the live model on silence instead "
                    "of the idle loop")
    lv.add_argument("--motion", choices=("off", "natural", "lively"), default="natural",
                    help="head motion and gaze glances (the control page can change it live)")
    lv.add_argument("--no-speech-glances", action="store_true", help="gaze glances in idle only, "
                    "none at sentence boundaries (TH_LIVE_SPEECH_GLANCES=0)")
    lv.add_argument("--seconds", type=float, default=12.0, help="make-idle: longest loop, seconds")
    lv.add_argument("--pick", default=None, help="make-idle: use this candidate track (default: best)")
    lv.add_argument("--only", default=None, help="make-idle: comma-separated candidate tracks to render")

    lb = sub.add_parser("live-bench", help="the live engine headless: run dir + live.json")
    lb.add_argument("--script", default=None, help="a script id; each paragraph is one line")
    lb.add_argument("--idle-s", type=float, default=0.0, help="instead: N s of silence (idle look)")
    lb.add_argument("--upscale", choices=KINDS, default="none")
    lb.add_argument("--seed", type=int, default=1116)
    lb.add_argument("--no-metrics", action="store_true", help="skip SyncNet/identity")
    lb.add_argument("--lead-s", type=float, default=2.0, help="idle before the first line, seconds")
    lb.add_argument("--tail-s", type=float, default=1.5, help="idle after the last line, seconds")
    lb.add_argument("--matte", action="store_true", help="matting on (frames still recorded without alpha)")
    lb.add_argument("--motion", choices=("off", "natural", "lively"), default="natural",
                    help="head motion and gaze glances")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.cmd == "fetch":
        from .fetch import fetch

        try:
            fetch(args.target, force=args.force)
        except NotImplementedError as e:
            raise SystemExit(f"th fetch: {e}") from None
    elif args.cmd == "audio":
        from .audio import render_audio
        from .ffmpeg import duration_s

        wav = render_audio(args.script, force=args.force)
        print(f"{wav} ({duration_s(wav):.2f} s)")
    elif args.cmd == "render":
        from .render import render

        run = render(args.arm, args.script, seed=args.seed, runtime=args.runtime,
                     portrait=args.portrait, alpha=not args.no_alpha, metrics=not args.no_metrics)
        print(run)
    elif args.cmd == "board" and args.action == "reveal":
        from .reveal import VerdictError, reveal

        try:
            print(reveal(args.out))
        except VerdictError as e:
            raise SystemExit(f"th board reveal: {e}") from None
    elif args.cmd == "board":
        from .board import build

        if not args.runs:
            parser.error("th board: --runs is required to build a board")

        runs = [Path(r.strip()) for r in args.runs.split(",") if r.strip()]
        print(build(runs, args.seed, args.out))
    elif args.cmd == "live" and args.action == "make-idle":
        from .live.idle import make_idle

        print(make_idle(args.seconds, args.pick, args.only.split(",") if args.only else None))
    elif args.cmd == "live":
        from .live.env import run_live

        # --fake has no GPU frames to upscale
        extra = ["--port", str(args.port), "--upscale", "none" if args.fake else args.upscale]
        for o in args.allow_origin:
            extra += ["--allow-origin", o]
        extra += ["--matte"] if args.matte else []
        extra += ["--no-idle-loop"] if args.no_idle_loop else []
        extra += ["--motion", args.motion]
        if args.no_speech_glances:  # read by th/live/gaze.py in the server process
            import os

            os.environ["TH_LIVE_SPEECH_GLANCES"] = "0"
        return run_live(extra + (["--fake"] if args.fake else []))
    elif args.cmd == "live-bench":
        from .live.bench import bench

        print(bench(args.script, args.upscale, args.seed, args.idle_s, metrics=not args.no_metrics,
                    lead_s=args.lead_s, tail_s=args.tail_s, matte=args.matte, motion=args.motion))
    return 0


if __name__ == "__main__":
    sys.exit(main())
