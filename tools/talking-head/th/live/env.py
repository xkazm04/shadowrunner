"""Core-env side of `th live` / `th live-bench`: the FlashHead env's python, the one-time install of
th/live/requirements.txt into it (a marker file holds the list's hash), and spawning
`python -m th.live ...` there with tools/talking-head on PYTHONPATH and Kokoro's worker python set."""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

from ..paths import TOOL_DIR, th_home

ENV = "realtime-fh"
REQUIREMENTS = Path(__file__).with_name("requirements.txt")
MARKER = ".th-live-requirements"


def fh_env() -> Path:
    return th_home() / "envs" / ENV


def fh_python() -> Path:
    sub = "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    return fh_env() / sub


def fh_repo() -> Path:
    return th_home() / "repos" / ENV


def check_env() -> None:
    if not fh_python().is_file() or not fh_repo().is_dir():
        raise SystemExit(f"th live: the FlashHead env is missing ({fh_env()}); run `uv run th fetch "
                         "realtime-fh` first")


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()[:16]


def ensure_requirements() -> bool:
    """Install the live requirements into the FlashHead env once per version of the list.
    Returns True when it installed."""
    check_env()
    marker = fh_env() / MARKER
    want = requirements_hash()
    if marker.is_file() and marker.read_text(encoding="utf-8").strip() == want:
        return False
    uv = shutil.which("uv")
    if not uv:
        raise SystemExit("th live: 'uv' is not on PATH")
    argv = [uv, "pip", "install", "--python", str(fh_python()), "-r", str(REQUIREMENTS)]
    print("th$ " + " ".join(argv), file=sys.stderr)
    subprocess.run(argv, check=True)
    marker.write_text(want + "\n", encoding="utf-8", newline="\n")
    return True


def child_env() -> dict[str, str]:
    return {**os.environ,
            "PYTHONPATH": str(TOOL_DIR) + os.pathsep + os.environ.get("PYTHONPATH", ""),
            "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
            # Kokoro runs in the core env (numpy 2); see th/live/tts.py
            "TH_LIVE_TTS_PYTHON": os.environ.get("TH_LIVE_TTS_PYTHON") or sys.executable}


def spawn(args: list[str], **popen) -> subprocess.Popen:
    # the child exits when this process dies, however it dies (Windows does not kill a child with
    # its parent), so a killed `th live` never leaves a server or a GPU holder behind
    argv = [str(fh_python()), "-m", "th.live", "--parent-pid", str(os.getpid()), *args]
    print("th$ " + " ".join(argv), file=sys.stderr)
    return subprocess.Popen(argv, cwd=fh_repo(), env=child_env(), **popen)


def ensure_maxine() -> None:
    """NVIDIA's nvidia-vfx wheel for the FlashHead env's python (idempotent: a no-op when unpacked).
    A failure only warns: the server then starts on `none` and says why in an error event."""
    code = subprocess.run([str(fh_python()), "-m", "th.live.upscale.maxine", "fetch"],
                          cwd=fh_repo(), env=child_env()).returncode
    if code != 0:
        print("th live: maxine fetch failed; the server will fall back to --upscale none",
              file=sys.stderr)


def run_live(args: list[str]) -> int:
    """`th live`: install once, then run the server in the FlashHead env until Ctrl+C."""
    ensure_requirements()
    if "--upscale" in args and args[args.index("--upscale") + 1] == "maxine":
        ensure_maxine()
    proc = spawn(["serve", *args])
    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        try:
            return proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            return proc.wait()
