"""The always-on stream: one GPU thread turns 0.96 s audio slices into 24 frames, forever.

Stream clock: ms since streaming began (perf_counter based). Chunk k covers [k*960, (k+1)*960) ms;
frame i has pts i*40. The audio fed to FlashHead for chunk k is exactly the audio emitted for it,
each piece at the pts of its first sample, so lip-sync holds by construction.

Audio FIFO: segments (a say/chat line's sentence, or a mic packet) wait in order; each chunk takes
one 15360-sample slice from the front and pads with silence (silence is never sent as audio).

Pacing (bounded queue): chunk k starts computing no earlier than T_k - LEAD_MS when a full slice is
ready, and at T_k - LATEST_MS when idle or starved (so a fresh line still makes the next chunk). So
at most ~LEAD_MS (2 chunks) of picture exists ahead of the wall clock; the encode/emit queue holds
at most EMIT_QUEUE chunks and blocks the GPU thread beyond that. A chunk that would start a whole
chunk late is skipped (`dropped`) and the clock jumps forward instead of drifting.

Frames go through the upscaler on the GPU, then JPEG encoding runs on a thread pool, so the GPU loop
never waits on encoding; an emitter thread hands finished chunks to `sink` in order.
"""

from __future__ import annotations

import collections
import queue
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from . import protocol as P
from .models import CHUNK_MS, RATE, SLICE_SAMPLES, Model
from .upscale import Upscaler, get_upscaler

LEAD_MS = 2 * CHUNK_MS
LATEST_MS = CHUNK_MS
EMIT_QUEUE = 2
CLIENT_PLAYOUT_MS = 250
MIC_MAX_SAMPLES = 2 * SLICE_SAMPLES  # mic backlog beyond this is dropped (oldest first)



@dataclass(eq=False)
class Line:
    id: str
    text: str | None
    received: float = field(default_factory=time.perf_counter)
    received_ms: float = 0.0  # stream clock at receipt
    closed: bool = False
    cut: bool = False
    start_ms: float | None = None
    end_ms: float | None = None
    first_frame_ms: float | None = None
    tts_first_ms: float | None = None  # receipt -> first synthesised audio
    kind: str = "say"  # say | chat
    reply_first_ms: float | None = None  # chat: receipt -> first sentence from the LLM


@dataclass(eq=False)
class Segment:
    line: Line | None  # None: mic
    pcm16k: np.ndarray
    play: np.ndarray
    rate: int
    events: list[tuple[str, str]] = field(default_factory=list)  # (kind, text) at its first sample
    pos: int = 0


@dataclass
class Chunk:
    index: int
    pts_ms: float
    epoch: int
    frames: list[Future] | list[bytes]
    width: int
    height: int
    audio: list[tuple[float, int, np.ndarray, Line | None]]  # pts, rate, samples, line
    events: list[dict]
    starts: list[Line]
    ends: list[Line]
    chunk_ms: float
    upscale_ms: float | None
    upscale: str
    silent: bool


Sink = Callable[[str, Any], None]  # ("chunk", Chunk) | ("event", dict) | ("state", None)


class Engine:
    def __init__(self, model: Model, sink: Sink, upscale: str = "none", jpeg_workers: int = 4,
                 raw_frames: bool = False) -> None:
        self.model = model
        self.sink = sink
        self.raw_frames = raw_frames  # bench: keep numpy frames instead of JPEG
        self.ready = False
        self.source = "text"
        self.upscaler: Upscaler = get_upscaler("none")  # `upscale` loads on the GPU thread
        self._want_up = upscale
        self._pending_up: Upscaler | None = None
        self._lock = threading.Condition()
        self._fifo: collections.deque[Segment] = collections.deque()
        self._open: list[Line] = []  # lines accepted and not yet ended
        self._ending: list[Line] = []  # fully taken by a chunk that has not been emitted yet
        self._epoch = 0
        self._t0: float | None = None
        self._stop = threading.Event()
        self._pool = ThreadPoolExecutor(jpeg_workers, thread_name_prefix="jpeg")
        self._emitq: queue.Queue[Chunk | None] = queue.Queue(EMIT_QUEUE)
        self._threads = [threading.Thread(target=self._gpu_loop, name="gpu", daemon=True),
                         threading.Thread(target=self._emit_loop, name="emit", daemon=True)]
        self.stats: dict[str, Any] = {"chunks": 0, "dropped": 0, "chunkMs": [], "upscaleMs": [],
                                      "startDelays": []}
        self.error: BaseException | None = None

    # ---- clock and state -------------------------------------------------------------------------

    def now_ms(self) -> float:
        return -LATEST_MS if self._t0 is None else (time.perf_counter() - self._t0) * 1000

    @property
    def size(self) -> int:
        return self.model.size * self.upscaler.scale

    @property
    def queue_len(self) -> int:
        return len(self._open) + len(self._ending)

    def delay_ms(self) -> int:
        """Command -> audible estimate: median measured (line-start pts - stream ms at receipt) over
        the last lines, plus the out client's playout buffer. Before any line: half a chunk of
        boundary wait plus the idle start lead."""
        d = list(self.stats["startDelays"])[-5:]
        base = float(np.median(d)) if d else LATEST_MS + CHUNK_MS / 2
        return int(round(base + CLIENT_PLAYOUT_MS))

    def start(self) -> None:
        for t in self._threads:
            t.start()

    def close(self) -> None:
        self._stop.set()
        with self._lock:
            self._lock.notify_all()
        for t in self._threads:
            t.join(timeout=10)
        self._pool.shutdown(wait=False, cancel_futures=True)

    # ---- inputs (any thread) ---------------------------------------------------------------------

    def open_line(self, line: Line) -> None:
        with self._lock:
            line.received_ms = self.now_ms()
            self._open.append(line)

    def enqueue(self, seg: Segment) -> None:
        with self._lock:
            if seg.line is not None and (seg.line.cut or seg.line not in self._open):
                return
            self._fifo.append(seg)
            if seg.line is None:
                self._trim_mic()
            self._lock.notify_all()

    def close_line(self, line: Line) -> None:
        with self._lock:
            line.closed = True
            self._lock.notify_all()

    def stop(self, ids: set[str] | None = None) -> list[Line]:
        """Cut queued speech (all of it, or only the lines in `ids`): audio not yet emitted is
        dropped, and every cut line gets a `line-end` with text "stopped" at the current time."""
        with self._lock:
            cut = [ln for ln in self._open + self._ending if ids is None or ln.id in ids]
            for ln in cut:
                ln.cut = True
                (self._open if ln in self._open else self._ending).remove(ln)
            self._fifo = collections.deque(s for s in self._fifo
                                           if not (s.line is None and ids is None) and
                                           not (s.line is not None and s.line.cut))
            if ids is None:
                self._epoch += 1
            at = max(0.0, self.now_ms())
        for ln in cut:
            self.sink("event", P.event("line-end", at, ln.id, "stopped"))
        self.sink("state", None)
        return cut

    def set_source(self, source: str) -> None:
        with self._lock:
            self.source = source
            if source == "text":
                self._fifo = collections.deque(s for s in self._fifo if s.line is not None)

    def set_upscale(self, kind: str) -> None:
        """Load and warm the upscaler off the GPU thread; it takes over at the next chunk."""
        def load() -> None:
            up = self._load_upscaler(kind)
            if up is not None:
                with self._lock:
                    self._pending_up = up

        threading.Thread(target=load, name=f"upscale-{kind}", daemon=True).start()

    def _load_upscaler(self, kind: str) -> Upscaler | None:
        """The warmed upscaler, or None plus one `error` event naming the reason (unknown kind,
        weights not fetched, SDK failure); the stream carries on with the current one."""
        try:
            up = get_upscaler(kind)
            up.warmup()
            return up
        except Exception as e:
            self.sink("event", P.event("error", max(0.0, self.now_ms()), None, f"upscale {kind}: {e}"))
            return None

    def _swap_upscaler(self, up: Upscaler) -> None:
        old, self.upscaler = self.upscaler, up
        close = getattr(old, "close", None)  # e.g. Maxine frees its SDK handles
        if close is not None and old is not up:
            close()
        self.sink("state", None)

    def _trim_mic(self) -> None:
        mic = [s for s in self._fifo if s.line is None]
        excess = sum(len(s.pcm16k) - s.pos for s in mic) - MIC_MAX_SAMPLES
        while excess > 0 and mic:
            s = mic.pop(0)
            self._fifo.remove(s)
            excess -= len(s.pcm16k) - s.pos

    # ---- the GPU thread --------------------------------------------------------------------------

    def _gpu_loop(self) -> None:
        try:
            self.model.load()
            if self._want_up != "none":  # a failure here leaves `none` and one error event
                self.upscaler = self._load_upscaler(self._want_up) or self.upscaler
            self._t0 = time.perf_counter() + LATEST_MS / 1000  # chunk 0 starts computing now
            self.ready = True
            self.sink("state", None)
            k = 0
            while not self._stop.is_set():
                k = self._wait_turn(k)
                if k < 0:
                    break
                self._emitq.put(self._compute(k))
                k += 1
        except BaseException as e:  # surfaced by the server/bench; the thread must not die silently
            self.error = e
            self.sink("event", P.event("error", max(0.0, self.now_ms()), None, f"engine: {e!r}"))
        finally:
            self._emitq.put(None)

    def _wait_turn(self, k: int) -> int:
        with self._lock:
            while not self._stop.is_set():
                t = k * CHUNK_MS
                now = self.now_ms()
                if now > t + CHUNK_MS:  # a whole chunk late: skip ahead, never drift
                    nk = int(now // CHUNK_MS) + 1
                    self.stats["dropped"] += nk - k
                    k = nk
                    continue
                queued = sum(len(s.pcm16k) - s.pos for s in self._fifo)
                waiting = self.source == "mic" or any(not ln.closed for ln in self._open)
                full = queued >= SLICE_SAMPLES or (queued > 0 and not waiting)
                start_at = t - (LEAD_MS if full else LATEST_MS)
                if now >= start_at:
                    return k
                self._lock.wait(min(0.05, (start_at - now) / 1000))
        return -1

    def _take_slice(self, t_ms: float) -> tuple[np.ndarray, list, list[dict], list[Line], list[Line]]:
        buf = np.zeros(SLICE_SAMPLES, np.float32)
        audio: list[tuple[float, int, np.ndarray, Line | None]] = []
        events: list[dict] = []
        starts: list[Line] = []
        ends: list[Line] = []
        o = 0
        with self._lock:
            while o < SLICE_SAMPLES and self._fifo:
                s = self._fifo[0]
                at = t_ms + o * 1000 / RATE
                ln = s.line
                if ln is not None and ln.start_ms is None:
                    ln.start_ms = at
                    self.stats["startDelays"].append(at - ln.received_ms)
                    events.append(P.event("line-start", at, ln.id, None))
                    starts.append(ln)
                if s.pos == 0:
                    events += [P.event(kind, at, ln.id if ln else None, text) for kind, text in s.events]
                take = min(SLICE_SAMPLES - o, len(s.pcm16k) - s.pos)
                buf[o:o + take] = s.pcm16k[s.pos:s.pos + take]
                a = round(s.pos * s.rate / RATE)
                s.pos += take
                b = len(s.play) if s.pos >= len(s.pcm16k) else round(s.pos * s.rate / RATE)
                prev = audio[-1] if audio else None
                if ln is None and prev and prev[3] is None and prev[1] == s.rate and abs(prev[0] + len(prev[2]) * 1000 / s.rate - at) < 0.5:
                    audio[-1] = (prev[0], s.rate, np.concatenate([prev[2], s.play[a:b]]), None)
                elif b > a:
                    audio.append((at, s.rate, s.play[a:b], ln))
                o += take
                if ln is not None:
                    ln.end_ms = t_ms + o * 1000 / RATE
                if s.pos >= len(s.pcm16k):
                    self._fifo.popleft()
            pending = {id(s.line) for s in self._fifo}
            for ln in list(self._open):
                if ln.closed and id(ln) not in pending:
                    if ln.start_ms is None:  # nothing was spoken (empty TTS): mark it here
                        ln.start_ms = ln.end_ms = t_ms + o * 1000 / RATE
                        events.append(P.event("line-start", ln.start_ms, ln.id, None))
                        starts.append(ln)
                    events.append(P.event("line-end", ln.end_ms, ln.id, None))
                    self._open.remove(ln)
                    self._ending.append(ln)
                    ends.append(ln)
        return buf, audio, events, starts, ends

    def _compute(self, k: int) -> Chunk:
        if self._pending_up is not None:
            with self._lock:
                up, self._pending_up = self._pending_up, None
            self._swap_upscaler(up)
        t_ms = k * CHUNK_MS
        epoch = self._epoch
        buf, audio, events, starts, ends = self._take_slice(t_ms)
        t0 = time.perf_counter()
        frames = self.model.chunk(buf)
        up_ms = None
        if self.upscaler.kind != "none":
            import torch

            torch.cuda.synchronize()
            t1 = time.perf_counter()
            try:
                frames = self.upscaler(frames)
                torch.cuda.synchronize()
                up_ms = (time.perf_counter() - t1) * 1000
                self.stats["upscaleMs"].append(up_ms)
            except Exception as e:  # never crash the stream: fall back to none, say why once
                self.sink("event", P.event("error", max(0.0, self.now_ms()), None,
                                           f"upscale {self.upscaler.kind} failed, using none: {e}"))
                self._swap_upscaler(get_upscaler("none"))
        arr = frames if isinstance(frames, np.ndarray) else frames.cpu().numpy()
        chunk_ms = (time.perf_counter() - t0) * 1000
        self.stats["chunkMs"].append(chunk_ms)
        self.stats["chunks"] += 1
        n, h, w = arr.shape[:3]
        if self.raw_frames:
            out: list = [arr[i] for i in range(n)]
        else:
            out = [self._pool.submit(_jpeg, arr[i]) for i in range(n)]
        return Chunk(k, t_ms, epoch, out, w, h, audio, events, starts, ends, chunk_ms, up_ms,
                     self.upscaler.kind, not audio)

    # ---- the emitter thread ----------------------------------------------------------------------

    def _emit_loop(self) -> None:
        while True:
            c = self._emitq.get()
            if c is None:
                return
            if not self.raw_frames:
                try:
                    c.frames = [f.result() for f in c.frames]
                except Exception:  # pool shut down on close
                    return
            # a stop came after this chunk took its slice: drop the cut lines' audio and events (and
            # the mic's, on a full stop); the frames still go out, the stream never pauses
            with self._lock:
                for ln in c.ends:
                    if ln in self._ending:
                        self._ending.remove(ln)
            cut = ({ln.id for ln in c.starts + c.ends if ln.cut}
                   | {a[3].id for a in c.audio if a[3] and a[3].cut})
            c.audio = [a for a in c.audio if not (a[3].cut if a[3] else c.epoch != self._epoch)]
            c.events = [e for e in c.events if e["id"] not in cut or e["kind"] == "slide"]
            c.starts = [ln for ln in c.starts if not ln.cut]
            self.sink("chunk", c)
            if c.events and any(e["kind"] in ("line-start", "line-end") for e in c.events):
                self.sink("state", None)


def _jpeg(frame: np.ndarray) -> bytes:
    from PIL import Image

    bio = __import__("io").BytesIO()
    Image.fromarray(frame).save(bio, "JPEG", quality=P.JPEG_QUALITY)
    return bio.getvalue()
