"""The rig arms' renderer: scripts/portrait/timeline-capture.mjs (the real avatar player in headless
Chromium, stepped at 30 fps) run from this checkout, its output streamed into the run's log."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Sequence

from ..arms.base import ArmEnv, ArmNotBuilt
from ..paths import TOOL_DIR

CHECKOUT = TOOL_DIR.parent.parent
SCRIPT = CHECKOUT / "scripts" / "portrait" / "timeline-capture.mjs"
PACK = CHECKOUT / "apps" / "web" / "public" / "packs" / "iris.srpack"
SIZE = 1024  # the Iris rig's own canvas: rig px map 1:1 to frame px
PORT = 5312


def node() -> str:
    found = shutil.which("node")
    if not found:
        raise ArmNotBuilt("node is not on PATH (the rig arms render through the web player)")
    return found


def check_ready() -> None:
    """Fail fast (preflight): node, the checkout's node_modules and the built Iris pack."""
    node()
    if not (CHECKOUT / "node_modules").is_dir():
        raise ArmNotBuilt(f"no node_modules in {CHECKOUT}: run `pnpm install` there")
    if not PACK.is_file():
        raise ArmNotBuilt(f"{PACK} is missing: run `th fetch <arm>` (or `node scripts/build-packs.mjs`)")


def build_packs(log: Path | None = None) -> None:
    """apps/web/public/packs/ (git-ignored) from the committed rigs; fixed bytes per run."""
    ArmEnv("baseline").run([node(), str(CHECKOUT / "scripts" / "build-packs.mjs")], cwd=CHECKOUT, log=log)


def capture(out: Path, *, log: Path | None, audio: Path | None = None, timeline: Path | None = None,
            text: Path | None = None, mouth_rest: bool = False, seed: int = 1,
            frames: int | None = None, keep: Sequence[int] = (), keep_dir: Path | None = None,
            hashes: Path | None = None, size: int = SIZE) -> float:
    """Runs the capture; returns its wall seconds. Raises on a failure (see `log`)."""
    args: list[str | Path] = [node(), SCRIPT, "--out", out, "--size", str(size), "--seed", str(seed),
                              "--port", str(PORT)]
    if timeline is not None:
        args += ["--timeline", timeline]
    if audio is not None:
        args += ["--audio", audio]
    if text is not None:
        args += ["--text", text]
    if mouth_rest:
        args.append("--mouth-rest")
    if frames is not None:
        args += ["--frames", str(frames)]
    if keep:
        args += ["--keep", ",".join(map(str, keep)), "--keep-dir", keep_dir or out.parent]
    if hashes is not None:
        args += ["--hashes", hashes]
    return ArmEnv("baseline").run(args, cwd=CHECKOUT, log=log)
