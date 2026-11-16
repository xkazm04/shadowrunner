"""Where things live: TH_HOME (models, audio, envs, lock), the main checkout, run dirs."""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = TOOL_DIR / "scripts"


def th_home() -> Path:
    """$TH_HOME, default ~/.talking-head: outside every checkout so worktrees share weights."""
    home = Path(os.environ.get("TH_HOME") or Path.home() / ".talking-head")
    home.mkdir(parents=True, exist_ok=True)
    return home


def models_dir(name: str) -> Path:
    return th_home() / "models" / name


def audio_dir() -> Path:
    d = th_home() / "audio"
    d.mkdir(parents=True, exist_ok=True)
    return d


@lru_cache(maxsize=1)
def main_checkout() -> Path:
    """The main checkout, also from a worktree: `git rev-parse --git-common-dir` minus `/.git`."""
    out = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=TOOL_DIR, capture_output=True, text=True, check=True,
    ).stdout.strip()
    common = Path(out)
    return common.parent if common.name == ".git" else common


def kokoro_dir() -> Path:
    env = os.environ.get("TH_KOKORO_DIR")
    return Path(env) if env else main_checkout() / "var" / "lab" / "models"


def runs_dir() -> Path:
    env = os.environ.get("TH_RUNS_DIR")
    d = Path(env) if env else main_checkout() / "var" / "talking-head" / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def portrait_path() -> Path:
    """Iris; the repo-relative path is the same in every checkout."""
    return TOOL_DIR.parent.parent / "assets" / "characters" / "companions" / "iris" / "portrait.png"


def script_path(script_id: str) -> Path:
    p = SCRIPTS_DIR / f"{script_id}.txt"
    if not p.is_file():
        known = ", ".join(sorted(s.stem for s in SCRIPTS_DIR.glob("*.txt")))
        raise SystemExit(f"th: unknown script '{script_id}' (known: {known})")
    return p


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def new_run_dir(arm: str, script: str) -> Path:
    base = runs_dir() / f"{utc_stamp()}-{arm}-{script}"
    d, n = base, 1
    while d.exists():  # two runs in the same second
        n += 1
        d = base.with_name(f"{base.name}-{n}")
    d.mkdir(parents=True)
    return d
