"""GPU arbitration and measurement: the $TH_HOME/gpu.lock file lock, the exclusivity check and a
VRAM sampling thread (nvidia-smi).

Exclusivity: on Windows (WDDM) `nvidia-smi --query-compute-apps` reports used memory as [N/A] per
process, so per-process dedicated VRAM comes from the Windows "GPU Process Memory" performance
counter (typeperf) instead; on Linux nvidia-smi's per-process figure is used. A process other than
this one holding more than OTHER_MIB_LIMIT counts as contention.

The desktop compositor (dwm.exe) is skipped on Windows: its counter reports committed rather than
resident memory (measured 27,953 MiB on a 24,564 MiB card while the whole adapter held 1,304 MiB),
and it is always present, so it would make every run "not exclusive".
"""

from __future__ import annotations

import csv
import io
import os
import re
import subprocess
import sys
import threading
from contextlib import contextmanager
from typing import Iterator

from filelock import FileLock, Timeout

from .paths import th_home

OTHER_MIB_LIMIT = 500
WINDOWS_SKIP = frozenset({"dwm.exe"})
_PID_RE = re.compile(r"pid_(\d+)_")


@contextmanager
def gpu_lock(wait_s: float | None = None) -> Iterator[None]:
    """Hold $TH_HOME/gpu.lock for the duration; waits (forever by default) for another holder."""
    # TH_GPU_LOCK overrides the path: the test suite points it at a temp file so tests never queue
    # behind (or block) a real render.
    lock = FileLock(os.environ.get("TH_GPU_LOCK") or str(th_home() / "gpu.lock"))
    try:
        lock.acquire(timeout=1)
    except Timeout:
        print("th: waiting for the GPU lock (another th render holds it)...", file=sys.stderr)
        lock.acquire(timeout=-1 if wait_s is None else wait_s)
    try:
        yield
    finally:
        lock.release()


def _smi(query: str) -> list[list[str]]:
    out = subprocess.run(
        ["nvidia-smi", f"--query-{query}", "--format=csv,noheader,nounits"],
        capture_output=True, text=True, timeout=10,
    )
    if out.returncode != 0:
        return []
    return [[c.strip() for c in row] for row in csv.reader(io.StringIO(out.stdout)) if row]


def memory_used_mib() -> int | None:
    rows = _smi("gpu=memory.used")
    try:
        return int(rows[0][0])
    except (IndexError, ValueError):
        return None


def per_process_mib() -> dict[int, int] | None:
    """pid -> dedicated VRAM MiB, or None when this machine cannot tell."""
    if sys.platform == "win32":
        return _per_process_windows()
    rows = _smi("compute-apps=pid,used_memory")
    try:
        return {int(r[0]): int(r[1]) for r in rows}
    except (IndexError, ValueError):
        return None


def _per_process_windows() -> dict[int, int] | None:
    try:
        out = subprocess.run(
            ["typeperf", r"\GPU Process Memory(*)\Dedicated Usage", "-sc", "1"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    rows = [r for r in csv.reader(io.StringIO(out)) if len(r) > 1]
    if len(rows) < 2:
        return None
    header, values = rows[0], rows[1]
    skip = _pids_named(WINDOWS_SKIP)
    usage: dict[int, int] = {}
    for name, value in zip(header[1:], values[1:]):
        m = _PID_RE.search(name)
        try:
            v = float(value)
        except ValueError:
            continue
        if m and int(m.group(1)) not in skip:  # one instance per adapter (LUID); summed
            pid = int(m.group(1))
            usage[pid] = usage.get(pid, 0) + int(v / (1024 * 1024))
    return usage


def _pids_named(names: frozenset[str]) -> set[int]:
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                             timeout=30).stdout
    except (OSError, subprocess.TimeoutExpired):
        return set()
    pids = set()
    for row in csv.reader(io.StringIO(out)):
        if len(row) > 1 and row[0].lower() in names and row[1].isdigit():
            pids.add(int(row[1]))
    return pids


def others_over_limit(own_pids: set[int] | None = None) -> list[tuple[int, int]] | None:
    """Processes other than ours holding > OTHER_MIB_LIMIT MiB, or None if unmeasurable."""
    usage = per_process_mib()
    if usage is None:
        return None
    mine = {os.getpid()} | (own_pids or set())
    return sorted((p, m) for p, m in usage.items() if p not in mine and m > OTHER_MIB_LIMIT)


class VramSampler:
    """Samples total memory.used every `interval_s`; `peak_delta_mib` = peak minus the baseline
    taken at start, i.e. what the run added on top of whatever was resident."""

    def __init__(self, interval_s: float = 0.25) -> None:
        self.interval_s = interval_s
        self.baseline: int | None = None
        self.peak: int | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self) -> None:
        while not self._stop.is_set():
            used = memory_used_mib()
            if used is not None:
                self.peak = used if self.peak is None else max(self.peak, used)
            self._stop.wait(self.interval_s)

    def __enter__(self) -> "VramSampler":
        self.baseline = memory_used_mib()
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    @property
    def peak_delta_mib(self) -> int | None:
        if self.baseline is None or self.peak is None:
            return None
        return max(0, self.peak - self.baseline)

