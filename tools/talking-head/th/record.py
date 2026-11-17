"""The one `th-run/1` builder: every producer (th render, th live-bench, dub_repost) calls
build_record instead of assembling RunRecord by hand, so the rules live once:

- width/height/fps/durationS are read back from the ffprobe dict of video.mp4;
- rtf = renderS / audio seconds (docs/talking-head.md), null when renderS is;
- gpuExclusive is None when either side is unmeasurable, else true only when both sides are empty.

Pure apart from `stage`, which appends one line to a log file.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, TypeVar

from .ffmpeg import fps_of, video_stream
from .paths import TOOL_DIR
from .schema import SCHEMA, Identity, RunRecord, Runtime, Sync

if TYPE_CHECKING:
    from .post.metrics import Metrics

T = TypeVar("T")
Others = list[tuple[int, int]] | None


@dataclass(frozen=True)
class Timing:
    render_s: float | None
    audio_s: float
    ttff_ms: float | None = None
    vram_peak_mib: int | None = None


@dataclass(frozen=True)
class Provenance:
    arm: str
    script: str
    seed: int
    portrait: str  # repo-relative, see repo_relative
    runtime: Runtime


def build_record(probe: dict, metrics: Metrics, timing: Timing, provenance: Provenance,
                 weights: Iterable[Any], notes: str | None, gpu_exclusive: bool | None = None) -> RunRecord:
    vs = video_stream(probe)
    render_s = timing.render_s
    return RunRecord(
        schema=SCHEMA, arm=provenance.arm, script=provenance.script, seed=provenance.seed,
        portrait=provenance.portrait, runtime=provenance.runtime,
        width=int(vs["width"]), height=int(vs["height"]), fps=round(fps_of(vs), 3),
        durationS=round(float(probe["format"]["duration"]), 3),
        renderS=None if render_s is None else round(render_s, 3),
        rtf=None if render_s is None else round(render_s / timing.audio_s, 4),
        ttffMs=timing.ttff_ms, vramPeakMiB=timing.vram_peak_mib, gpuExclusive=gpu_exclusive,
        sync=Sync(conf=metrics.sync_conf, offsetFrames=metrics.sync_offset),
        identity=Identity(**metrics.identity), faceRoi=metrics.face_roi,
        weights=list(weights), notes=notes,
    )


def gpu_exclusive(start: Others, end: Others) -> bool | None:
    """True when no other process held VRAM over the limit at start and end; None if unmeasurable."""
    return None if start is None or end is None else not start and not end


def contention_notes(label: str, others: Others) -> list[str]:
    if others is None:
        return [f"gpuExclusive unmeasurable at {label} (no per-process VRAM figure)"]
    if others:
        return [f"other GPU processes at {label}: " + ", ".join(f"pid {p} {mib} MiB" for p, mib in others)]
    return []


def join_notes(notes: Iterable[str | None], extra: Iterable[str] = ()) -> str | None:
    """'; '-joined non-empty notes, or None (the key is still written, as null)."""
    return "; ".join(n for n in [*notes, *extra] if n) or None


def repo_relative(p: Path) -> str:
    try:
        return p.resolve().relative_to(TOOL_DIR.parent.parent.resolve()).as_posix()
    except ValueError:
        return p.as_posix()


def stage(log: Path, label: str, fn: Callable[..., T], /, *args: Any, **kw: Any) -> T:
    """Run fn and append 'stage <label>: <s>s' to the log."""
    t = time.perf_counter()
    out = fn(*args, **kw)
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(f"stage {label}: {time.perf_counter() - t:.1f}s\n")
    return out
