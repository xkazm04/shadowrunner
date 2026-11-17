"""GPU health around a heavy run (common brief: this 4090 logs nvlddmkm errors under load):
the System-log count of nvlddmkm events in the last N minutes, and nvidia-smi memory/utilisation."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass

PS_COUNT = ("(Get-WinEvent -FilterHashtable @{{LogName='System'; ProviderName='nvlddmkm'; "
            "StartTime=(Get-Date).AddMinutes(-{minutes})}} -ErrorAction SilentlyContinue | "
            "Measure-Object).Count")


@dataclass(frozen=True)
class Health:
    driver_errors: int | None   # nvlddmkm events in the window (None off Windows)
    used_mb: int | None
    total_mb: int | None
    util_pct: int | None

    def line(self) -> str:
        return (f"nvlddmkm events {self.driver_errors}, VRAM {self.used_mb}/{self.total_mb} MB, "
                f"util {self.util_pct}%")


def parse_smi(text: str) -> tuple[int, int, int] | None:
    """'4272, 24564, 47' -> (4272, 24564, 47); first GPU only."""
    for row in text.strip().splitlines():
        parts = [p.strip() for p in row.split(",")]
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            return int(parts[0]), int(parts[1]), int(parts[2])
    return None


def driver_errors(minutes: int = 30) -> int | None:
    if sys.platform != "win32":
        return None
    out = subprocess.run(["powershell", "-NoProfile", "-Command", PS_COUNT.format(minutes=minutes)],
                         capture_output=True, text=True, timeout=60)
    txt = out.stdout.strip()
    return int(txt) if txt.isdigit() else None


def check(minutes: int = 30) -> Health:
    smi = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
                          "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
    vals = parse_smi(smi.stdout) if smi.returncode == 0 else None
    used, total, util = vals if vals else (None, None, None)
    return Health(driver_errors(minutes), used, total, util)
