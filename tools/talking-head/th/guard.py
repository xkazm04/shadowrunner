"""Resource thresholds for every heavy subprocess (renders, measures): the desktop always keeps a
reserve of host memory, and a render that grows without limit fails inside its own box instead of
taking the PC down (2026-11-24: two renders ate all memory and had to be killed by hand).

Three layers, Windows only (elsewhere the guard is a no-op):
- admission: wait until the system's available commit covers the reserve plus a floor, then size
  the cap to what is really free (never more than TH_MEM_CAP_GB);
- hard cap: the process tree runs in a Job Object with a job memory limit (committed memory of
  the whole tree), KILL_ON_JOB_CLOSE and below-normal priority; past the cap allocations fail
  (MemoryError / CUDA host OOM) and the run ends with its own error;
- watchdog: every TH_GUARD_POLL_S the available commit is read; under the reserve the render's
  processes are suspended, and resumed once it is back above reserve + hysteresis; a render
  paused longer than TH_PAUSE_MAX_S is terminated.

WDDM charges VRAM allocations to the process's committed memory (measured: +4.01 GB commit
per 4 GB of torch VRAM, `experiments/hands/wddm_commit.py`), so the job cap is the host budget
plus the GPU's VRAM (TH_MEM_VRAM_GB, default: nvidia-smi's total, 0 without a GPU).

Thresholds come from the environment (GB unless noted): TH_MEM_CAP_GB 40 (host budget), TH_MEM_RESERVE_GB 12,
TH_MEM_FLOOR_GB 8, TH_MEM_HYST_GB 4, TH_ADMIT_WAIT_S 900, TH_PAUSE_MAX_S 900, TH_GUARD_POLL_S 2,
TH_PRIORITY below_normal|idle|normal, TH_GUARD 0 to switch it off. Note: a `docker run` client is
capped, not the container (Docker's VM has its own limit)."""

from __future__ import annotations

import os
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

GB = 1024 ** 3
WINDOWS = sys.platform == "win32"


@dataclass(frozen=True)
class Limits:
    cap_gb: float = 40.0
    reserve_gb: float = 12.0
    floor_gb: float = 8.0
    hyst_gb: float = 4.0
    admit_wait_s: float = 900.0
    pause_max_s: float = 900.0
    poll_s: float = 2.0
    priority: str = "below_normal"
    enabled: bool = True
    vram_gb: float | None = None   # None: read the GPU's total at admission

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Limits":
        e = os.environ if env is None else env
        d = cls()

        def f(name: str, default: float) -> float:
            raw = e.get(name)
            return float(raw) if raw not in (None, "") else default

        return cls(cap_gb=f("TH_MEM_CAP_GB", d.cap_gb), reserve_gb=f("TH_MEM_RESERVE_GB", d.reserve_gb),
                   floor_gb=f("TH_MEM_FLOOR_GB", d.floor_gb), hyst_gb=f("TH_MEM_HYST_GB", d.hyst_gb),
                   admit_wait_s=f("TH_ADMIT_WAIT_S", d.admit_wait_s),
                   pause_max_s=f("TH_PAUSE_MAX_S", d.pause_max_s), poll_s=f("TH_GUARD_POLL_S", d.poll_s),
                   priority=e.get("TH_PRIORITY", d.priority) or d.priority,
                   enabled=e.get("TH_GUARD", "1") != "0",
                   vram_gb=float(e["TH_MEM_VRAM_GB"]) if e.get("TH_MEM_VRAM_GB") else None)


# --- pure decisions (unit-tested) ------------------------------------------------------------

def admit_cap_gb(avail_gb: float, lim: Limits, vram_gb: float = 0.0) -> float | None:
    """The job cap a render may start with when `avail_gb` of commit is free: what is free beyond
    the reserve, at most the host budget plus the VRAM WDDM charges to commit. None when that is
    under the floor (wait, or refuse)."""
    room = min(lim.cap_gb + vram_gb, avail_gb - lim.reserve_gb)
    return room if room >= lim.floor_gb else None


def watch_action(avail_gb: float, paused: bool, paused_for_s: float, lim: Limits) -> str:
    """One watchdog tick: 'pause', 'resume', 'kill' or 'none'."""
    if paused:
        if avail_gb >= lim.reserve_gb + lim.hyst_gb:
            return "resume"
        return "kill" if paused_for_s >= lim.pause_max_s else "none"
    return "pause" if avail_gb < lim.reserve_gb else "none"


# --- Windows plumbing -------------------------------------------------------------------------

if WINDOWS:
    import ctypes
    import ctypes.wintypes as wt

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _ntdll = ctypes.WinDLL("ntdll")
    _k32.CreateJobObjectW.restype = wt.HANDLE
    _k32.OpenProcess.restype = wt.HANDLE

    class _MemStatus(ctypes.Structure):
        _fields_ = [("dwLength", wt.DWORD), ("dwMemoryLoad", wt.DWORD),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    class _Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wt.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wt.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wt.DWORD), ("SchedulingClass", wt.DWORD)]

    class _Io(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class _Ext(ctypes.Structure):
        _fields_ = [("Basic", _Basic), ("Io", _Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    _EXT_INFO = 9
    _PID_LIST = 3
    _LIMIT_JOB_MEMORY = 0x200
    _LIMIT_KILL_ON_CLOSE = 0x2000
    _LIMIT_PRIORITY = 0x20
    _PRIORITY = {"idle": 0x40, "below_normal": 0x4000, "normal": 0x20}
    _PROCESS_ALL = 0x1F0FFF


def avail_commit_gb() -> float | None:
    """System-wide commit still available (RAM + pagefile headroom), GB; None off Windows."""
    if not WINDOWS:
        return None
    st = _MemStatus()
    st.dwLength = ctypes.sizeof(st)
    if not _k32.GlobalMemoryStatusEx(ctypes.byref(st)):
        return None
    return st.ullAvailPageFile / GB


class Job:
    """A Job Object that caps a process tree's committed memory and lowers its priority."""

    def __init__(self, cap_gb: float, priority: str) -> None:
        self.handle = _k32.CreateJobObjectW(None, None)
        info = _Ext()
        info.Basic.LimitFlags = _LIMIT_JOB_MEMORY | _LIMIT_KILL_ON_CLOSE | _LIMIT_PRIORITY
        info.Basic.PriorityClass = _PRIORITY.get(priority, _PRIORITY["below_normal"])
        info.JobMemoryLimit = int(cap_gb * GB)
        if not _k32.SetInformationJobObject(self.handle, _EXT_INFO, ctypes.byref(info), ctypes.sizeof(info)):
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject")

    def assign(self, pid: int) -> None:
        h = _k32.OpenProcess(_PROCESS_ALL, False, pid)
        try:
            if not _k32.AssignProcessToJobObject(self.handle, h):
                raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject")
        finally:
            _k32.CloseHandle(h)

    def peak_gb(self) -> float:
        info = _Ext()
        _k32.QueryInformationJobObject(self.handle, _EXT_INFO, ctypes.byref(info), ctypes.sizeof(info), None)
        return info.PeakJobMemoryUsed / GB

    def pids(self) -> list[int]:
        class _List(ctypes.Structure):
            _fields_ = [("Assigned", wt.DWORD), ("InList", wt.DWORD), ("Ids", ctypes.c_size_t * 256)]
        lst = _List()
        _k32.QueryInformationJobObject(self.handle, _PID_LIST, ctypes.byref(lst), ctypes.sizeof(lst), None)
        return [int(lst.Ids[i]) for i in range(lst.InList)]

    def _each(self, fn: Callable[[int], int]) -> None:
        for pid in self.pids():
            h = _k32.OpenProcess(_PROCESS_ALL, False, pid)
            if h:
                fn(h)
                _k32.CloseHandle(h)

    def suspend(self) -> None:
        self._each(_ntdll.NtSuspendProcess)

    def resume(self) -> None:
        self._each(_ntdll.NtResumeProcess)

    def terminate(self) -> None:
        _k32.TerminateJobObject(self.handle, 1)

    def close(self) -> None:
        _k32.CloseHandle(self.handle)


def gpu_total_gb() -> float:
    """The GPU's VRAM, GB (nvidia-smi); 0 when there is none or it can't be read."""
    from .gpu import _smi
    try:
        return int(_smi("gpu=memory.total")[0][0]) / 1024
    except (IndexError, ValueError, OSError):
        return 0.0


class ResourceRefused(RuntimeError):
    """Admission timed out: the machine never had room for the render."""


@dataclass
class Guard:
    """Wraps one subprocess: `admit()` before Popen, `attach(pid)` right after, `close()` at the end."""
    lim: Limits = field(default_factory=Limits.from_env)
    log: Callable[[str], None] = lambda s: print(s, file=sys.stderr, flush=True)
    read_avail: Callable[[], float | None] = avail_commit_gb
    cap_gb: float | None = None
    paused_s: float = 0.0
    killed: bool = False
    _job: "Job | None" = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    @property
    def active(self) -> bool:
        return WINDOWS and self.lim.enabled

    def admit(self, sleep: Callable[[float], None] = time.sleep) -> float | None:
        if not self.active:
            return None
        waited = 0.0
        vram = self.lim.vram_gb if self.lim.vram_gb is not None else gpu_total_gb()
        while True:
            avail = self.read_avail()
            if avail is None:
                return None
            cap = admit_cap_gb(avail, self.lim, vram)
            if cap is not None:
                self.cap_gb = cap
                self.log(f"guard: admitted, {avail:.1f} GB free, cap {cap:.1f} GB (host {self.lim.cap_gb:.0f} + VRAM {vram:.0f}), "
                         f"reserve {self.lim.reserve_gb:.0f} GB, priority {self.lim.priority}")
                return cap
            if waited >= self.lim.admit_wait_s:
                raise ResourceRefused(f"guard: only {avail:.1f} GB commit free after {waited:.0f} s; "
                                      f"need {self.lim.reserve_gb + self.lim.floor_gb:.0f} GB")
            if waited == 0:
                self.log(f"guard: waiting for memory ({avail:.1f} GB free, "
                         f"need {self.lim.reserve_gb + self.lim.floor_gb:.0f} GB)")
            sleep(self.lim.poll_s * 5)
            waited += self.lim.poll_s * 5

    def attach(self, pid: int) -> None:
        if not self.active or self.cap_gb is None:
            return
        self._job = Job(self.cap_gb, self.lim.priority)
        self._job.assign(pid)
        self._thread = threading.Thread(target=self._watch, daemon=True)
        self._thread.start()

    def _watch(self) -> None:
        paused_at: float | None = None
        while not self._stop.wait(self.lim.poll_s):
            avail = self.read_avail()
            if avail is None or self._job is None:
                continue
            for_s = time.monotonic() - paused_at if paused_at is not None else 0.0
            act = watch_action(avail, paused_at is not None, for_s, self.lim)
            if act == "pause":
                self._job.suspend()
                paused_at = time.monotonic()
                self.log(f"guard: PAUSED render, only {avail:.1f} GB commit free (reserve {self.lim.reserve_gb:.0f})")
            elif act == "resume":
                self._job.resume()
                self.paused_s += for_s
                paused_at = None
                self.log(f"guard: resumed after {for_s:.0f} s ({avail:.1f} GB free)")
            elif act == "kill":
                self.killed = True
                self.log(f"guard: KILLED render, paused {for_s:.0f} s without memory coming back")
                self._job.terminate()
                return

    def close(self) -> str | None:
        """Stop watching; returns a one-line summary for the run log."""
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        if self._job is None:
            return None
        line = (f"guard: peak {self._job.peak_gb():.1f} GB of cap {self.cap_gb:.1f} GB, "
                f"paused {self.paused_s:.0f} s" + (", killed by the watchdog" if self.killed else ""))
        self._job.close()
        self._job = None
        return line
