"""`python -m th.live <serve|bench>` inside the FlashHead env (spawned by `th live` / `th live-bench`).

serve: the fhl/1 server. bench: the same engine headless (see bench.py).
`--fake` swaps FlashHead and Kokoro for synthetic stand-ins (no GPU), for UI work and tests.
asyncio keeps its default loop (Proactor on Windows): the chat module spawns the claude CLI.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from .upscale import KINDS


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m th.live")
    p.add_argument("--parent-pid", type=int, default=None, help="exit when this process ends (set by th)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--upscale", choices=KINDS, default="none")
    s.add_argument("--allow-origin", action="append", default=[])
    s.add_argument("--portrait", type=Path, default=None, help="default: Iris (bust-cropped)")
    s.add_argument("--seed", type=int, default=1116)
    s.add_argument("--fake", action="store_true", help="synthetic model and voice (no GPU)")
    s.add_argument("--matte", action="store_true", help="start with matting on (0x04 frames)")
    s.add_argument("--no-idle-loop", action="store_true", help="show the live model when silent")
    s.add_argument("--motion", choices=("off", "natural", "lively"), default="natural")
    b = sub.add_parser("bench")
    b.add_argument("--script", default=None)
    b.add_argument("--idle-s", type=float, default=0.0)
    b.add_argument("--upscale", choices=KINDS, default="none")
    b.add_argument("--seed", type=int, default=1116)
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--lead-s", type=float, default=2.0)
    b.add_argument("--tail-s", type=float, default=1.5)
    b.add_argument("--matte", action="store_true")
    b.add_argument("--motion", choices=("off", "natural", "lively"), default="natural")
    m = sub.add_parser("make-idle")
    m.add_argument("--work", type=Path, required=True)
    m.add_argument("--seconds", type=float, default=12.0)
    m.add_argument("--names", required=True)
    m.add_argument("--pick", default=None)
    return p


def make_model(fake: bool, portrait: Path | None, seed: int):
    from .gaze import gaze_refs
    from .models import FakeModel, FlashHeadModel, bust_crop

    if fake:
        return FakeModel(size=256, compute_s=0.3)
    return FlashHeadModel(bust_crop() if portrait is None else portrait, seed=seed, refs=gaze_refs())


def serve(args: argparse.Namespace) -> int:
    from . import tts
    from .chat import reply_sentences
    from .engine import Engine
    from .server import LiveServer, run

    if args.fake:
        tts.set_backend(tts.FakeTts())
    server = LiveServer(args.allow_origin)
    engine = Engine(make_model(args.fake, args.portrait, args.seed), server.sink, upscale=args.upscale,
                    matte=args.matte, loop=None if args.no_idle_loop else "auto", motion=args.motion,
                    seed=args.seed)
    server.attach(engine, tts.speak, reply_sentences)

    async def main() -> None:
        # start Kokoro's worker (model load) while FlashHead loads, not on the first line
        warm = asyncio.create_task(asyncio.to_thread(tts.backend().warmup))
        await run(server, engine, args.port)
        await warm

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        tts.backend().close()
    return 1 if engine.error else 0


def _exit_with_parent(pid: int) -> None:
    """Spawned by the core CLI: leave as soon as that process is gone (the port and the GPU go with
    us; Kokoro's worker follows when its stdin closes). Waits on the process handle on Windows (a
    thread blocked reading stdin there stalls the server's own start-up), polls elsewhere."""
    import os
    import threading
    import time

    def watch() -> None:
        if sys.platform == "win32":
            import ctypes

            k32 = ctypes.windll.kernel32
            handle = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
            if handle:
                k32.WaitForSingleObject(handle, 0xFFFFFFFF)
        else:
            while os.getppid() == pid:
                time.sleep(1)
        print("th live: parent process gone; exiting", file=sys.stderr, flush=True)
        os._exit(0)

    threading.Thread(target=watch, name="parent-watch", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.parent_pid:
        _exit_with_parent(args.parent_pid)
    if args.cmd == "serve":
        return serve(args)
    if args.cmd == "make-idle":
        from .idle import render_idle

        return render_idle(args.work, args.seconds, args.names.split(","), args.pick)
    from .bench import run_headless

    return run_headless(args.script, args.idle_s, args.upscale, args.seed, args.out,
                        args.lead_s, args.tail_s, args.matte, args.motion)


if __name__ == "__main__":
    sys.exit(main())
