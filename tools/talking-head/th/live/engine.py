"""The always-on stream: one GPU thread turns 0.96 s audio slices into 24 frames, forever.

Stream clock: ms since streaming began (perf_counter based). Chunk k covers [k*960, (k+1)*960) ms;
frame i has pts i*40. The audio fed to FlashHead for chunk k is exactly the audio emitted for it,
each piece at the pts of its first sample, so lip-sync holds by construction.

Audio FIFO: segments (a say/chat line's sentence, or a mic packet) wait in order; each chunk takes
one 15360-sample slice from the front and pads with silence (silence is never sent as audio).

Pacing (bounded queue): chunk k starts computing no earlier than T_k - LEAD_MS when a full slice is
ready, and at T_k - lookahead() when idle or starved (so a fresh line still makes the next chunk;
stages.py: adaptive 750-960 ms, or TH_LIVE_LOOKAHEAD_MS). So at most ~LEAD_MS (2 chunks) of
picture exists ahead of the wall clock; the encode/emit queue holds at most EMIT_QUEUE chunks and
blocks the GPU thread beyond that. A chunk that would start a whole
chunk late is skipped (`dropped`) and the clock jumps forward instead of drifting.

Frames go through compose.py (seam blend, idle loop), the matte and the upscaler on the GPU, then
JPEG encoding runs on a thread pool, so the GPU loop never waits on encoding; an emitter thread
hands finished chunks to `sink` in order. A chunk's frames start at `pts_ms`, which is HOLD frames
before its slice while the seam blend holds the previous chunk's last frames.
"""

from __future__ import annotations

import collections
import os
import queue
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from . import protocol as P
from .compose import HOLD, TAIL_MS, Compositor, load_loop
from .models import CHUNK_MS, RATE, SLICE_FRAMES, SLICE_SAMPLES, Model
from .stages import Stages, jpeg_frame as _jpeg, jpeg_pair as _jpeg_pair
from .upscale import Upscaler, get_upscaler

LEAD_MS = 2 * CHUNK_MS
LATEST_MS = float(os.environ.get("TH_LIVE_LOOKAHEAD_MS") or CHUNK_MS)  # idle look-ahead: fixed, or the
LOOKAHEAD_AUTO = not os.environ.get("TH_LIVE_LOOKAHEAD_MS")  # ceiling of the adaptive one (stages.py)
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
    done: bool = False  # its line-end is placed (end_ms is final)
    cut_ms: float | None = None


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
    idle: str = "live"  # what shows at the chunk's last frame: live | loop


Sink = Callable[[str, Any], None]  # ("chunk", Chunk) | ("event", dict) | ("state", None)


class Engine(Stages):
    def __init__(self, model: Model, sink: Sink, upscale: str = "none", jpeg_workers: int = 4,
                 raw_frames: bool = False, matte: bool = False, loop: Any = None,
                 motion: str = "plain", seed: int = 1116) -> None:
        """`loop`: the idle loop's frames, "auto" ($TH_HOME/live/idle/iris/loop.npz) or None.
        `motion`: head motion and gaze glances, off | natural | lively (stages.py, round 3)."""
        self.model = model
        self.sink = sink
        self.raw_frames = raw_frames  # bench: keep numpy frames instead of JPEG
        self.ready = False
        self.source = "text"
        self.upscaler: Upscaler = get_upscaler("none")  # `upscale` loads on the GPU thread
        self._want_up = upscale
        self._pending_up: Upscaler | None = None
        self.matte: Any = None  # a th.live.matte Matte while matting is on
        self._want_matte = matte
        self._pending_matte: Any = None  # a Matte, or False: switch it off at the next chunk
        self.post = Compositor(load_loop(model.size) if isinstance(loop, str) else loop)
        self.idle_mode = "loop" if self.post.has_loop else "live"
        self._spoken: list[Line] = []  # lines that started: the live/loop weight follows them
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
                                      "matteMs": [], "startDelays": [], "lookaheadMs": [], "motionMs": [],
                                      "motion": []}
        self.error: BaseException | None = None
        self._init_motion(motion, seed)

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
        base = float(np.median(d)) if d else self.lookahead() + CHUNK_MS / 2
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
                ln.cut_ms = at
        for ln in cut:
            self.sink("event", P.event("line-end", at, ln.id, "stopped"))
        self.sink("state", None)
        return cut

    def set_source(self, source: str) -> None:
        with self._lock:
            self.source = source
            if source == "text":
                self._fifo = collections.deque(s for s in self._fifo if s.line is not None)

    def _live_at(self, pts: float) -> bool:
        """Whether the live model shows at `pts` (else the idle loop): from HOLD frames before a
        line's first sample to TAIL_MS after its end (open lines: until they end); always on mic."""
        if self.source == "mic" or self._glance_live(pts):
            return True
        for ln in self._spoken:
            end = ln.cut_ms if ln.cut_ms is not None else (ln.end_ms if ln.done else None)
            if ln.start_ms - HOLD * 40 <= pts and (end is None or pts <= end + TAIL_MS):
                return True
        return False

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
            if self._want_matte:  # a failure leaves matting off and one error event
                self.matte = self._load_matte()
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
                start_at = t - (LEAD_MS if full else self.lookahead())
                if now >= start_at:
                    return k
                self._lock.wait(min(0.05, (start_at - now) / 1000))
        return -1

    def _take_slice(self, t_ms: float) -> tuple[np.ndarray, list, list[dict], list[Line], list[Line],
                                                list[float]]:
        """Audio, sent pieces, events, starting/ending lines, sentence-start offsets (ms)."""
        buf = np.zeros(SLICE_SAMPLES, np.float32)
        sents: list[float] = []
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
                    self._spoken.append(ln)
                    self.stats["startDelays"].append(at - ln.received_ms)
                    events.append(P.event("line-start", at, ln.id, None))
                    starts.append(ln)
                if s.pos == 0:
                    if ln is not None:
                        sents.append(o * 1000 / RATE)
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
                    ln.done = True
                    self._open.remove(ln)
                    self._ending.append(ln)
                    ends.append(ln)
        return buf, audio, events, starts, ends, sents

    def _compute(self, k: int) -> Chunk:
        self._apply_pending()
        self.stats["lookaheadMs"].append(self.lookahead())
        t_ms = k * CHUNK_MS
        epoch = self._epoch
        buf, audio, events, starts, ends, sents = self._take_slice(t_ms)
        t0 = time.perf_counter()
        self._gaze_turn(k, len(sents), bool(audio) or self.source == "mic")
        new = self.model.chunk(buf)
        self.motion.feed(k * SLICE_FRAMES, buf, sents)
        first, frames = self.post.seam(k, new, getattr(self.model, "motion_frames", None))
        if self._switched and not audio:
            frames = self._dissolve(frames, first, k)
        frames, idle = self.post.compose(first, frames, self._live_at)
        self._spoken = [ln for ln in self._spoken if (ln.cut_ms is None and not ln.done)
                        or (ln.cut_ms if ln.cut_ms is not None else ln.end_ms) + TAIL_MS > t_ms - CHUNK_MS]
        alpha = self._matte_frames(frames) if self.matte is not None else None
        frames, alpha = self._move(first, frames, alpha)
        frames, alpha, up_ms = self._upscale(frames, alpha)
        arr = frames if isinstance(frames, np.ndarray) else frames.cpu().numpy()
        al = alpha if alpha is None or isinstance(alpha, np.ndarray) else alpha.cpu().numpy()
        chunk_ms = (time.perf_counter() - t0) * 1000
        self.stats["chunkMs"].append(chunk_ms)
        self.stats["chunks"] += 1
        n, h, w = arr.shape[:3]
        if self.raw_frames:
            out: list = [arr[i] for i in range(n)]
        elif al is None:
            out = [self._pool.submit(_jpeg, arr[i]) for i in range(n)]
        else:
            out = [self._pool.submit(_jpeg_pair, arr[i], al[i]) for i in range(n)]
        return Chunk(k, first * 40.0, epoch, out, w, h, audio, events, starts, ends, chunk_ms, up_ms,
                     self.upscaler.kind, not audio, idle)

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
            changed = c.idle != self.idle_mode
            self.idle_mode = c.idle
            if changed or any(e["kind"] in ("line-start", "line-end") for e in c.events):
                self.sink("state", None)

