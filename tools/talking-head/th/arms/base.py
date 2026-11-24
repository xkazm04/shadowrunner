"""The arm contract (`Arm`, `Job`, `RawResult`) and `ArmEnv`, the helper a heavy arm uses to run
its upstream repo in its own venv or container.

Heavy arms never add dependencies to tools/talking-head/pyproject.toml. `th fetch <arm>` clones
the upstream repo into $TH_HOME/repos/<arm>, builds $TH_HOME/envs/<arm> (or pulls an image) and
downloads weights into $TH_HOME/models/<arm>/ with a licence.json; `render` runs the upstream
inference as a subprocess whose output streams into the run's log.txt.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, ClassVar, Iterable, Sequence

import numpy as np

from ..guard import Guard
from ..paths import models_dir, th_home
from ..schema import Weight

FrameCallback = Callable[[np.ndarray], None]  # one RGB uint8 HxWx3 frame, as soon as it exists


@dataclass(frozen=True)
class Job:
    """What an arm renders: `portrait` speaking `audio` (wav), into `run_dir`."""

    arm: str
    script: str
    script_text: str
    audio: Path
    audio_s: float
    portrait: Path
    seed: int
    runtime: str
    run_dir: Path
    log: Path

    @property
    def raw(self) -> Path:
        return self.run_dir / "raw.mp4"


@dataclass
class RawResult:
    """`video` is the arm's native output (raw.mp4). The normaliser always muxes the job audio,
    so an arm that writes picture only is fine."""

    video: Path
    weights: list[Weight] = field(default_factory=list)
    notes: str | None = None


class ArmNotBuilt(NotImplementedError):
    pass


class Arm:
    id: ClassVar[str]
    runtimes: ClassVar[tuple[str, ...]] = ("native",)

    def fetch(self) -> list[Weight]:
        """Download weights / build the env for this arm; return what landed (licence.json rows)."""
        return []

    def weights(self) -> list[Weight]:
        """The licence.json rows of whatever this arm uses (read back after `fetch`)."""
        return read_licences(models_dir(self.id))

    def preflight(self, runtime: str) -> None:
        """Fail fast, before audio, a run dir or the GPU lock: raise ArmNotBuilt if this arm
        cannot run on `runtime` (override to also check fetched weights or a built env)."""
        if runtime not in self.runtimes:
            raise ArmNotBuilt(f"{runtime} runtime not implemented for {self.id}")

    def render(self, job: Job, on_frame: FrameCallback | None = None) -> RawResult:
        if job.runtime == "docker":
            return self.render_docker(job, on_frame)
        return self.render_native(job, on_frame)

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        raise ArmNotBuilt(f"{self.id}: native runtime not implemented")

    def render_docker(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        raise ArmNotBuilt(f"docker runtime not implemented for {self.id}")


class StubArm(Arm):
    """Placeholder until the owning work package replaces the module."""

    package: ClassVar[str] = "WP2/WP3"

    def fetch(self) -> list[Weight]:
        raise ArmNotBuilt(f"{self.id}: {self.package}")

    def preflight(self, runtime: str) -> None:
        raise ArmNotBuilt(f"{self.id}: {self.package}")

    def render_native(self, job: Job, on_frame: FrameCallback | None) -> RawResult:
        raise ArmNotBuilt(f"{self.id}: {self.package}")


def read_licences(d: Path) -> list[Weight]:
    p = d / "licence.json"
    if not p.is_file():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else [data]
    return [Weight.model_validate(r) for r in rows]


def write_licences(d: Path, rows: Iterable[Weight]) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    p = d / "licence.json"
    body = [r.model_dump(mode="json") for r in rows]
    p.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8", newline="\n")
    return p


class ArmEnv:
    """An arm's private world under $TH_HOME: repos/<arm> (upstream clone), envs/<arm> (its venv),
    models/<arm> (weights + licence.json)."""

    def __init__(self, arm_id: str) -> None:
        self.arm_id = arm_id
        self.repo = th_home() / "repos" / arm_id
        self.env = th_home() / "envs" / arm_id
        self.models = models_dir(arm_id)

    @property
    def python(self) -> Path:
        sub = "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
        return self.env / sub

    def clone(self, url: str, revision: str) -> None:
        """Clone `url` at `revision` (a commit or tag) into .repo, once."""
        if not (self.repo / ".git").is_dir():
            self.repo.parent.mkdir(parents=True, exist_ok=True)
            _check([_exe("git"), "clone", url, str(self.repo)])
        _check([_exe("git"), "-C", str(self.repo), "checkout", "--quiet", revision])

    def make_venv(self, python: str = "3.12", requirements: Sequence[str] = (), *extra: str) -> None:
        """`uv venv` at .env, then `uv pip install` requirement files (*.txt) and specs."""
        if not self.python.is_file():
            _check([_exe("uv"), "venv", "--python", python, str(self.env)])
        if requirements or extra:
            args = [_exe("uv"), "pip", "install", "--python", str(self.python)]
            for r in requirements:
                args += ["-r", r] if r.endswith(".txt") else [r]
            _check(args + list(extra))

    def run(self, args: Sequence[str | Path], cwd: Path | None = None, log: Path | None = None,
            env: dict[str, str] | None = None) -> float:
        """Run `args` (args[0] == "python" means the arm venv's python), streaming stdout+stderr
        into `log` (appended) and our stderr. Returns wall seconds; raises on a non-zero exit."""
        first = str(self.python) if str(args[0]) == "python" else str(args[0])
        return _stream([first, *map(str, args[1:])], cwd or self.repo, log, env)

    def docker_run(self, image: str, args: Sequence[str | Path], mounts: dict[Path, str],
                   log: Path | None = None, gpus: bool = True, env: dict[str, str] | None = None,
                   workdir: str | None = None) -> float:
        """`docker run --rm` on the nvidia runtime with bind mounts {host path: container path}."""
        argv = [_exe("docker"), "run", "--rm"]
        if gpus:
            argv += ["--gpus", "all"]
        for host, inside in mounts.items():
            argv += ["-v", f"{Path(host).resolve()}:{inside}"]
        for k, v in (env or {}).items():
            argv += ["-e", f"{k}={v}"]
        if workdir:
            argv += ["-w", workdir]
        argv += [image, *map(str, args)]
        return _stream(argv, None, log, None)


def _exe(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise SystemExit(f"th: '{name}' is not on PATH")
    return found


def _check(argv: list[str]) -> None:
    print("th$ " + " ".join(argv), file=sys.stderr)
    subprocess.run(argv, check=True)


def _stream(argv: list[str], cwd: Path | None, log: Path | None, env: dict[str, str] | None) -> float:
    full_env = {**os.environ, **(env or {}), "PYTHONUNBUFFERED": "1"}
    t0 = time.perf_counter()
    fh = open(log, "a", encoding="utf-8") if log else None

    def note(line: str) -> None:
        sys.stderr.write(line + "\n")
        if fh:
            fh.write(line + "\n")
            fh.flush()

    guard = Guard(log=note)  # resource thresholds: admission, a memory cap, a pausing watchdog
    try:
        if fh:
            fh.write("$ " + " ".join(argv) + "\n")
            fh.flush()
        guard.admit()
        proc = subprocess.Popen(argv, cwd=cwd, env=full_env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        guard.attach(proc.pid)
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stderr.write(line)
            if fh:
                fh.write(line)
                fh.flush()
        code = proc.wait()
        summary = guard.close()
        if summary:
            note(summary)
    finally:
        guard.close()
        if fh:
            fh.close()
    if code != 0:
        raise RuntimeError(f"command failed ({code}): {' '.join(argv[:3])} ... (see {log})")
    return time.perf_counter() - t0
