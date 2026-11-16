"""`th live-bench`: the live engine headless, measured like `th render`.

Two halves. `run_headless` runs in the FlashHead env (`python -m th.live bench`): the same Engine and
Speaker as the server, with a recorder in place of the sockets. A script's paragraphs are said one
line at a time (the next 0.6 s after the previous line-end, after 2 s of idle), so every line's
firstFrameMs is a cold command -> first frame. It writes raw.mp4 (frames at the output size), speech.wav
(the emitted audio placed at its pts, 24 kHz) and bench.json. `--idle-s N` streams N s of silence only.

`bench` runs in the core env: GPU lock, spawn, then normalise, SyncNet/identity, sharpness (variance
of the Laplacian on the face crop of video.mp4) and run.json (`arm: "live-fh"`) + live.json.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np

ARM = "live-fh"
OUT_RATE = 24000
LINE_GAP_S = 0.6
LEAD_IDLE_S = 2.0
TAIL_S = 1.5


class Recorder:
    """The engine's sink in the bench: frames into raw.mp4, audio pieces and events kept."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.writer = None
        self.frames = 0
        self.audio: list[tuple[float, int, np.ndarray]] = []
        self.events: list[dict] = []
        self.ended: set[str] = set()
        self.emit_wall: list[float] = []
        self.slack: list[float] = []  # pts - stream clock at emission (ms): > 0 means ahead of time
        self.clock = lambda: 0.0
        self.size: tuple[int, int] | None = None
        self._last: np.ndarray | None = None
        self._lock = threading.Lock()

    def sink(self, kind: str, payload: Any) -> None:
        with self._lock:
            if kind == "chunk":
                self._chunk(payload)
            elif kind == "event":
                self.events.append(payload)

    def _chunk(self, c) -> None:
        from ..ffmpeg import FrameWriter

        if self.writer is None:
            self.size = (c.width, c.height)
            self.writer = FrameWriter(self.out / "raw.mp4", self.size, 25, "rgb24",
                                      ["-c:v", "libx264", "-preset", "fast", "-crf", "14",
                                       "-pix_fmt", "yuv420p"]).__enter__()
        if (c.width, c.height) != self.size:
            raise RuntimeError("the output size changed mid-bench")
        expected = int(round(c.pts_ms / 40))
        while self.frames < expected:  # a dropped chunk: hold the last frame, keep the clock
            self.writer.write(self._last)
            self.frames += 1
        for f in c.frames:
            self.writer.write(f)
            self._last = f
            self.frames += 1
        self.emit_wall.append(time.perf_counter())
        self.slack.append(c.pts_ms - self.clock())
        now = time.perf_counter()
        for ln in c.starts:
            ln.first_frame_ms = (now - ln.received) * 1000
        self.audio += [(pts, rate, s) for pts, rate, s, _ in c.audio]
        self.events += c.events
        self.ended |= {e["id"] for e in c.events if e["kind"] == "line-end"}

    def close(self) -> None:
        if self.writer is not None:
            self.writer.__exit__(None, None, None)
        track = np.zeros(int(self.frames * 40 * OUT_RATE / 1000), np.float32)
        for pts, rate, s in self.audio:
            if rate != OUT_RATE:  # only Kokoro (24 kHz) speaks in the bench; no mic
                raise RuntimeError(f"bench audio at {rate} Hz, expected {OUT_RATE}")
            i = int(round(pts * OUT_RATE / 1000))
            n = min(len(s), len(track) - i)
            if n > 0:
                track[i:i + n] = s[:n]
        with wave.open(str(self.out / "speech.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(OUT_RATE)
            w.writeframes((np.clip(track, -1, 1) * 32767).astype("<i2").tobytes())


def run_headless(script: str | None, idle_s: float, upscale: str, seed: int, out: Path,
                 lead_s: float = LEAD_IDLE_S, tail_s: float = TAIL_S, matte: bool = False) -> int:
    from . import tts
    from .engine import LATEST_MS, LOOKAHEAD_AUTO, Engine
    from .models import FlashHeadModel, bust_crop

    out.mkdir(parents=True, exist_ok=True)
    rec = Recorder(out)
    engine = Engine(FlashHeadModel(bust_crop(), seed=seed), rec.sink, upscale=upscale, raw_frames=True,
                    loop="auto", matte=matte)
    rec.clock = engine.now_ms
    t0 = time.perf_counter()
    try:
        lines = asyncio.run(_drive(engine, rec, script, idle_s, lead_s, tail_s))
    finally:
        engine.close()
        rec.close()
        tts.backend().close()
    if engine.error:
        raise engine.error
    st = engine.stats
    worker = getattr(tts.backend(), "started_ms", None)
    body = {
        "script": script, "idleS": idle_s, "upscale": upscale, "model": engine.model.name,
        "size": engine.size, "frames": rec.frames, "wallS": round(time.perf_counter() - t0, 2),
        "modelLoadS": getattr(engine.model, "load_s", None), "ttsWorkerStartMs": worker,
        "chunks": st["chunks"], "droppedChunks": st["dropped"],
        "chunkMs": [round(x, 1) for x in st["chunkMs"]], "upscaleMs": [round(x, 1) for x in st["upscaleMs"]],
        "emitWallS": [round(t - rec.emit_wall[0], 3) for t in rec.emit_wall] if rec.emit_wall else [],
        "slackMs": [round(x, 1) for x in rec.slack], "matteMs": [round(x, 1) for x in st["matteMs"]],
        "lookaheadMs": "auto" if LOOKAHEAD_AUTO else LATEST_MS,
        "lookaheadUsedMs": [round(x) for x in st["lookaheadMs"]], "seamBlend": engine.post.blend, "idleLoop": engine.post.has_loop,
        "lines": [{"id": ln.id, "text": ln.text, "receivedMs": _r(ln.received_ms), "startMs": _r(ln.start_ms),
                   "endMs": _r(ln.end_ms), "firstFrameMs": _r(ln.first_frame_ms),
                   "ttsFirstMs": _r(ln.tts_first_ms)} for ln in lines],
        "events": rec.events,
    }
    (out / "bench.json").write_text(json.dumps(body, indent=1) + "\n", encoding="utf-8", newline="\n")
    return 0


async def _drive(engine, rec: Recorder, script: str | None, idle_s: float, lead_s: float,
                 tail_s: float) -> list:
    from . import tts
    from .speaker import Speaker

    speaker = Speaker(engine, tts.speak, None)
    speaker.start()
    warm = asyncio.create_task(asyncio.to_thread(tts.backend().warmup))
    engine.start()
    await warm
    while not engine.ready:
        if engine.error:
            raise engine.error
        await asyncio.sleep(0.1)
    if not script:
        await asyncio.sleep(idle_s + 1.0)
    else:
        from ..audio import paragraphs, read_script

        await asyncio.sleep(lead_s)
        for i, para in enumerate(paragraphs(read_script(script))):
            line = speaker.say(f"p{i + 1}", " ".join(para))
            while line.id not in rec.ended:
                if engine.error:
                    raise engine.error
                await asyncio.sleep(0.02)
            await asyncio.sleep(LINE_GAP_S)
        await asyncio.sleep(tail_s)
    await speaker.close()
    return speaker.log


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 1)


def _pct(xs: list[float], q: float) -> float | None:
    return None if not xs else round(float(np.percentile(xs, q)), 1)


# ---- core env ------------------------------------------------------------------------------------


def bench(script: str | None, upscale: str = "none", seed: int = 1116, idle_s: float = 0.0,
          metrics: bool = True, lead_s: float = LEAD_IDLE_S, tail_s: float = TAIL_S,
          matte: bool = False) -> Path:
    from ..ffmpeg import duration_s, fps_of, probe, video_stream
    from ..gpu import VramSampler, gpu_lock, memory_used_mib, others_over_limit
    from ..paths import new_run_dir, portrait_path
    from .env import ensure_requirements, spawn

    if not script and idle_s <= 0:
        raise SystemExit("th live-bench: give --script or --idle-s")
    ensure_requirements()
    run_dir = new_run_dir(ARM, script or f"idle-{idle_s:g}s")
    log = run_dir / "log.txt"
    args = ["bench", "--upscale", upscale, "--seed", str(seed), "--out", str(run_dir)]
    args += ["--script", script] if script else ["--idle-s", str(idle_s)]
    args += ["--lead-s", str(lead_s), "--tail-s", str(tail_s)] + (["--matte"] if matte else [])
    co: dict[str, Any] = {}
    with gpu_lock():
        co["start"] = others_over_limit()
        co["usedMiBStart"] = memory_used_mib()
        t0 = time.perf_counter()
        with VramSampler() as vram, open(log, "a", encoding="utf-8") as fh:
            proc = spawn(args, stdout=fh, stderr=subprocess.STDOUT)
            code = proc.wait()
        wall = time.perf_counter() - t0
        co["end"] = others_over_limit()
        if code != 0:
            raise SystemExit(f"th live-bench: engine failed ({code}); see {log}")
        b = json.loads((run_dir / "bench.json").read_text(encoding="utf-8"))
        speech = run_dir / "speech.wav"
        video = run_dir / "video.mp4"
        from ..post.metrics import Metrics, measure
        from ..post.normalise import normalise

        normalise(run_dir / "raw.mp4", speech, duration_s(speech), video, log=log)
        m = measure(video, portrait_path()) if metrics else Metrics()
        sharp = sharpness(video, m.face_box)
        if not script:
            idle_sheet(run_dir / "raw.mp4", run_dir)
    from .measure import bench_seams

    live = summarise(b, m, sharp, co, vram.peak_delta_mib)
    live["seam"] = bench_seams(run_dir / "raw.mp4", b["lines"], b["size"])
    (run_dir / "live.json").write_text(json.dumps(live, indent=2) + "\n", encoding="utf-8", newline="\n")
    info = probe(video)
    vs = video_stream(info)
    _run_json(run_dir, script or live["script"], seed, info, vs, fps_of, wall, b, m, vram, co, live)
    return run_dir


def summarise(b: dict, m, sharp: float | None, co: dict, vram_mib: int | None) -> dict:
    cm, um = b["chunkMs"], b["upscaleMs"]
    slack = b["slackMs"]
    # sustained fps: frames that left before their pts, per stream second. Emission is paced to the
    # stream clock, so this is 25.0 exactly when no chunk was late or dropped; capacityFps is what the
    # GPU could do (24 frames / chunk compute time).
    on_time = sum(x >= 0 for x in slack)
    total = len(slack) + b["droppedChunks"]
    fps = round(25 * on_time / total, 2) if total else None
    p50 = _pct(cm, 50)
    return {
        "schema": "th-live/1", "script": b["script"] or f"idle-{b['idleS']:g}s", "upscale": b["upscale"],
        "model": b["model"], "size": b["size"], "frames": b["frames"], "fps": fps,
        "capacityFps": {"p50": None if not p50 else round(24000 / p50, 1),
                        "p95": None if not _pct(cm, 95) else round(24000 / _pct(cm, 95), 1)},
        "chunkMs": {"p50": p50, "p95": _pct(cm, 95), "max": _pct(cm, 100)},
        "upscaleMs": {"p50": _pct(um, 50), "p95": _pct(um, 95)},
        "matteMs": {"p50": _pct(b.get("matteMs", []), 50), "p95": _pct(b.get("matteMs", []), 95)},
        "droppedChunks": b["droppedChunks"], "chunks": b["chunks"],
        "slackMs": {"min": _pct(slack, 0), "p5": _pct(slack, 5)},
        "lateChunks": sum(x < 0 for x in slack),
        "lookaheadMs": b.get("lookaheadMs"), "seamBlend": b.get("seamBlend"), "idleLoop": b.get("idleLoop"),
        "startDelayMs": [None if ln["startMs"] is None else round(ln["startMs"] - ln["receivedMs"], 1)
                         for ln in b["lines"]],
        "lines": b["lines"], "firstFrameMs": {"p50": _pct([ln["firstFrameMs"] for ln in b["lines"]
                                                           if ln["firstFrameMs"] is not None], 50)},
        "sharpness": sharp, "sync": {"conf": m.sync_conf, "offsetFrames": m.sync_offset},
        "identity": m.identity, "vramPeakMiB": vram_mib,
        "modelLoadS": b["modelLoadS"], "ttsWorkerStartMs": b["ttsWorkerStartMs"],
        "gpuCoTenants": {"start": co.get("start"), "end": co.get("end"), "usedMiBStart": co.get("usedMiBStart")},
        "notes": m.notes,
    }


def _run_json(run_dir, script, seed, info, vs, fps_of, wall, b, m, vram, co, live) -> None:
    from ..arms.base import read_licences
    from ..fetch import core_weights
    from ..paths import portrait_path, th_home
    from ..render import _contention, _repo_relative
    from ..schema import SCHEMA, Identity, RunRecord, Sync

    notes: list[str] = []
    _contention("start", co["start"], notes)
    _contention("end", co["end"], notes)
    dur = float(info["format"]["duration"])
    first = [ln["firstFrameMs"] for ln in b["lines"] if ln["firstFrameMs"] is not None]
    rec = RunRecord(
        schema=SCHEMA, arm=ARM, script=script, seed=seed, portrait=_repo_relative(portrait_path()),
        runtime="native", width=int(vs["width"]), height=int(vs["height"]), fps=round(fps_of(vs), 3),
        durationS=round(dur, 3), renderS=round(wall, 3), rtf=round(wall / dur, 4),
        ttffMs=first[0] if first else None, vramPeakMiB=vram.peak_delta_mib,
        gpuExclusive=None if co["start"] is None or co["end"] is None else not co["start"] and not co["end"],
        sync=Sync(conf=m.sync_conf, offsetFrames=m.sync_offset), identity=Identity(**m.identity),
        faceRoi=m.face_roi,
        weights=[*read_licences(th_home() / "models" / "realtime-fh"), *core_weights()],
        notes="; ".join([f"live engine, bust crop, upscale {live['upscale']} ({live['size']} px); "
                         f"{live['fps']} fps delivered, capacity {live['capacityFps']['p50']} fps (p50), "
                         f"chunk p50/p95 {live['chunkMs']['p50']}/{live['chunkMs']['p95']} ms, "
                         f"{live['droppedChunks']} dropped; sharpness {live['sharpness']}",
                         *m.notes, *notes]),
    )
    rec.write(run_dir / "run.json")


def sharpness(video: Path, face_box: list[int] | None, every: int = 25) -> float | None:
    """Mean variance of the Laplacian over the face crop (grey, video.mp4 pixels), 1 frame/s."""
    if not face_box:
        return None
    from scipy.ndimage import laplace

    from ..ffmpeg import read_frames

    x, y, w, h = face_box
    vals = []
    for i, f in enumerate(read_frames(video, (1080, 1080), fps=25)):
        if i % every == 0:
            g = f[y:y + h, x:x + w].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
            vals.append(float(laplace(g).var()))
    return round(float(np.mean(vals)), 2) if vals else None


def idle_sheet(raw: Path, out: Path, n: int = 6) -> dict:
    """Idle look: a sheet of `n` frames spread over the clip, a 5 s clip from its middle, and
    motion figures (mean abs diff between consecutive frames, and of each frame vs the first)."""
    from PIL import Image

    from ..ffmpeg import duration_s, probe, read_frames, run_ffmpeg, video_stream

    vs = video_stream(probe(raw))
    size = (int(vs["width"]), int(vs["height"]))
    total = int(round(duration_s(raw) * 25))
    picks = np.linspace(0, total - 1, n).astype(int)
    tw = 320
    sheet = Image.new("RGB", (tw * 3, tw * ((n + 2) // 3)))
    step: list[float] = []
    drift: list[float] = []
    first = prev = None
    count = 0
    for i, f in enumerate(read_frames(raw, size)):
        g = f.astype(np.int16)
        first = g if first is None else first
        if prev is not None:
            step.append(float(np.abs(g - prev).mean()))
        drift.append(float(np.abs(g - first).mean()))
        prev = g
        count += 1
        for j in np.flatnonzero(picks == i):
            sheet.paste(Image.fromarray(f).resize((tw, tw)), ((j % 3) * tw, (j // 3) * tw))
    sheet.save(out / "idle-sheet.png")
    mid = max(0.0, duration_s(raw) / 2 - 2.5)
    run_ffmpeg(["-ss", f"{mid:.2f}", "-i", str(raw), "-t", "5", "-c:v", "libx264", "-crf", "16",
                "-pix_fmt", "yuv420p", str(out / "idle-5s.mp4")])
    stats = {"frames": count, "sheetFrames": picks.tolist(),
             "stepDiff": {"mean": round(float(np.mean(step)), 3), "p95": round(float(np.percentile(step, 95)), 3),
                          "max": round(float(np.max(step)), 3)},
             "driftFromFirst": {"mean": round(float(np.mean(drift)), 3), "max": round(float(np.max(drift)), 3)}}
    (out / "idle.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"th live-bench idle: {json.dumps(stats)}", file=sys.stderr)
    return stats
