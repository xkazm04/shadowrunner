"""Resource thresholds (th/guard.py): the pure decisions, and on Windows a real Job Object cap."""

from __future__ import annotations

import subprocess
import sys

import pytest

from th.guard import WINDOWS, Guard, Limits, ResourceRefused, admit_cap_gb, watch_action

LIM = Limits(cap_gb=40, reserve_gb=12, floor_gb=8, hyst_gb=4, admit_wait_s=10, pause_max_s=60, poll_s=1,
             vram_gb=0)


def test_limits_from_env() -> None:
    lim = Limits.from_env({"TH_MEM_CAP_GB": "30", "TH_MEM_RESERVE_GB": "16", "TH_PRIORITY": "idle",
                           "TH_GUARD": "0"})
    assert (lim.cap_gb, lim.reserve_gb, lim.priority, lim.enabled) == (30, 16, "idle", False)
    assert Limits.from_env({}) == Limits()


@pytest.mark.parametrize("avail, cap", [(80, 40), (52, 40), (40, 28), (20, 8), (19.9, None), (5, None)])
def test_admit_cap_keeps_the_reserve(avail: float, cap: float | None) -> None:
    assert admit_cap_gb(avail, LIM) == cap


@pytest.mark.parametrize("avail, cap", [(100, 64), (60, 48), (19.9, None)])
def test_admit_cap_adds_the_vram_wddm_charges(avail: float, cap: float | None) -> None:
    assert admit_cap_gb(avail, LIM, vram_gb=24) == cap


def test_vram_from_env() -> None:
    assert Limits.from_env({"TH_MEM_VRAM_GB": "24"}).vram_gb == 24
    assert Limits.from_env({}).vram_gb is None


@pytest.mark.parametrize("avail, paused, for_s, action", [
    (30, False, 0, "none"), (11.9, False, 0, "pause"),
    (13, True, 5, "none"),            # above the reserve but inside the hysteresis band
    (16, True, 5, "resume"), (5, True, 59, "none"), (5, True, 60, "kill"),
])
def test_watch_action(avail: float, paused: bool, for_s: float, action: str) -> None:
    assert watch_action(avail, paused, for_s, LIM) == action


def _guard(values: list[float]) -> Guard:
    it = iter(values)
    return Guard(lim=LIM, log=lambda s: None, read_avail=lambda: next(it))


@pytest.mark.skipif(not WINDOWS, reason="the guard is a no-op off Windows")
def test_admit_waits_then_admits() -> None:
    slept: list[float] = []
    g = _guard([10, 15, 60])
    assert g.admit(sleep=slept.append) == 40
    assert len(slept) == 2


@pytest.mark.skipif(not WINDOWS, reason="the guard is a no-op off Windows")
def test_admit_refuses_after_the_wait() -> None:
    g = _guard([10] * 10)
    with pytest.raises(ResourceRefused):
        g.admit(sleep=lambda s: None)


def test_disabled_guard_does_nothing() -> None:
    g = Guard(lim=Limits(enabled=False), log=lambda s: None, read_avail=lambda: 0.0)
    assert g.admit() is None
    g.attach(12345)
    assert g.close() is None


@pytest.mark.skipif(not WINDOWS, reason="Job Objects are Windows only")
def test_job_cap_stops_a_runaway_child() -> None:
    """A child allocating 256 MB at a time past a ~1 GB cap fails with MemoryError, the guard
    reports a peak at the cap, and the parent (this test) is untouched."""
    g = Guard(lim=Limits(cap_gb=1.0, reserve_gb=0, floor_gb=0.5, vram_gb=0), log=lambda s: None)
    assert g.admit() is not None
    code = ("import time\nb=[]\ntime.sleep(0.5)\n"
            "for i in range(16):\n    b.append(bytearray(256*1024*1024))\nprint('UNCAPPED')")
    proc = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True)
    g.attach(proc.pid)
    out, _ = proc.communicate(timeout=60)
    summary = g.close()
    assert proc.returncode != 0 and "MemoryError" in out and "UNCAPPED" not in out
    assert summary is not None and "cap 1.0 GB" in summary


@pytest.mark.skipif(not WINDOWS, reason="Job Objects are Windows only")
def test_watchdog_pauses_and_resumes_a_render() -> None:
    """Commit 'drops' under the reserve: the child's ticks stop; it 'comes back': they continue."""
    import time

    state = {"avail": 50.0}
    lim = Limits(cap_gb=2, reserve_gb=12, floor_gb=0.5, hyst_gb=4, pause_max_s=60, poll_s=0.1, vram_gb=0)
    g = Guard(lim=lim, log=lambda s: None, read_avail=lambda: state["avail"])
    assert g.admit() is not None
    code = "import time\nfor i in range(60):\n    print(i, flush=True); time.sleep(0.05)"
    proc = subprocess.Popen([sys.executable, "-u", "-c", code], stdout=subprocess.PIPE, text=True)
    g.attach(proc.pid)
    assert proc.stdout is not None
    proc.stdout.readline()
    state["avail"] = 5.0                       # under the reserve: pause
    time.sleep(0.5)
    t0 = time.monotonic()
    time.sleep(1.0)                            # stay low for 1 s
    held = time.monotonic() - t0
    state["avail"] = 50.0                      # back above reserve + hysteresis: resume
    out, _ = proc.communicate(timeout=30)
    summary = g.close()
    assert proc.returncode == 0 and out.strip().splitlines()[-1] == "59"
    assert summary is not None and "paused" in summary and g.paused_s >= held * 0.8
