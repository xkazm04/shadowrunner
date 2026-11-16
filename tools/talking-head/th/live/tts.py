"""Kokoro sentence streaming for live Iris (design "Interfaces": `speak`).

Kokoro (kokoro-onnx) needs numpy 2 and the FlashHead env is pinned to numpy 1 (mediapipe), so in the
live server Kokoro runs in ONE worker subprocess in the core th env (`th.live.tts_worker`, the python
named by TH_LIVE_TTS_PYTHON, which `th live` sets), started once (`warmup()` at server start) and
reused for every sentence. Where kokoro_onnx imports (the core env), it runs in-process instead.
Same model, voice and speed as `th audio` (th/audio.py).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import struct
import subprocess
import threading
import time
from pathlib import Path
from typing import AsyncIterator, Protocol

import numpy as np

SENTENCE_GAP_S = 0.22
FLASHHEAD_RATE = 16000
_HEAD = struct.Struct("<II")  # worker reply: n samples, sample rate; then n float32


class Backend(Protocol):
    def synth(self, sentence: str) -> tuple[np.ndarray, int]: ...

    def warmup(self) -> None: ...

    def close(self) -> None: ...


def sentences(text: str) -> list[str]:
    from ..audio import _SENTENCE

    flat = " ".join(text.split())
    return [s for s in _SENTENCE.split(flat) if s.strip()]


def to_16k(samples: np.ndarray, rate: int) -> np.ndarray:
    """FlashHead's wav2vec input rate; playback keeps the source rate."""
    if rate == FLASHHEAD_RATE:
        return samples.astype(np.float32, copy=False)
    from scipy.signal import resample_poly

    g = math.gcd(FLASHHEAD_RATE, rate)
    return resample_poly(samples, FLASHHEAD_RATE // g, rate // g).astype(np.float32)


class InProcessKokoro:
    def __init__(self) -> None:
        self._kokoro = None
        self._lock = threading.Lock()

    def warmup(self) -> None:
        with self._lock:
            if self._kokoro is None:
                from kokoro_onnx import Kokoro

                from ..audio import MODEL_FILE, VOICES_FILE
                from ..paths import kokoro_dir

                d = kokoro_dir()
                self._kokoro = Kokoro(str(d / MODEL_FILE), str(d / VOICES_FILE))

    def synth(self, sentence: str) -> tuple[np.ndarray, int]:
        from ..audio import LANG, SPEED, VOICE

        self.warmup()
        with self._lock:
            samples, rate = self._kokoro.create(sentence, voice=VOICE, speed=SPEED, lang=LANG)
        return np.asarray(samples, np.float32), int(rate)

    def close(self) -> None:
        self._kokoro = None


class WorkerKokoro:
    """One long-lived `python -m th.live.tts_worker` in the core env: a JSON line in, '<II' + float32
    out. A lock serialises sentences; a dead worker is restarted once on the next sentence."""

    def __init__(self, python: str) -> None:
        self.python = python
        self.proc: subprocess.Popen | None = None
        self.started_ms: float | None = None  # spawn -> ready (model load), for the report
        self._lock = threading.Lock()

    def _start(self) -> None:
        t0 = time.perf_counter()
        tool_dir = str(Path(__file__).resolve().parents[2])
        env = {**os.environ, "PYTHONPATH": tool_dir + os.pathsep + os.environ.get("PYTHONPATH", ""),
               "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen([self.python, "-m", "th.live.tts_worker"], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=None, env=env, cwd=tool_dir)
        n, rate = self._read_head()  # (0, 0) once the model is loaded
        if (n, rate) != (0, 0):
            raise RuntimeError(f"tts worker: bad ready header {(n, rate)}")
        self.started_ms = (time.perf_counter() - t0) * 1000

    def _read_head(self) -> tuple[int, int]:
        assert self.proc and self.proc.stdout
        head = self.proc.stdout.read(_HEAD.size)
        if len(head) < _HEAD.size:
            raise RuntimeError("tts worker exited (see its stderr above)")
        return _HEAD.unpack(head)

    def warmup(self) -> None:
        with self._lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()

    def synth(self, sentence: str) -> tuple[np.ndarray, int]:
        with self._lock:
            for attempt in (0, 1):
                if self.proc is None or self.proc.poll() is not None:
                    self._start()
                try:
                    assert self.proc and self.proc.stdin and self.proc.stdout
                    self.proc.stdin.write((json.dumps({"text": sentence}) + "\n").encode())
                    self.proc.stdin.flush()
                    n, rate = self._read_head()
                    buf = self.proc.stdout.read(n * 4)
                    if len(buf) < n * 4:
                        raise RuntimeError("tts worker exited mid-reply")
                    return np.frombuffer(buf, "<f4").copy(), rate
                except (OSError, RuntimeError):
                    self.close()
                    if attempt:
                        raise
        raise AssertionError("unreachable")

    def close(self) -> None:
        if self.proc is not None:
            try:
                self.proc.kill()
                self.proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
            self.proc = None


class FakeTts:
    """Tests and `--fake`: a tone burst per sentence, 60 ms per character (min 0.3 s), at 24 kHz."""

    rate = 24000

    def __init__(self, ms_per_char: float = 60.0, delay_s: float = 0.0) -> None:
        self.ms_per_char = ms_per_char
        self.delay_s = delay_s

    def warmup(self) -> None:
        return None

    def synth(self, sentence: str) -> tuple[np.ndarray, int]:
        if self.delay_s:
            time.sleep(self.delay_s)
        n = int(self.rate * max(0.3, len(sentence) * self.ms_per_char / 1000))
        t = np.arange(n) / self.rate
        return (0.3 * np.sin(2 * np.pi * 220 * t) * np.sin(np.pi * t * 4) ** 2).astype(np.float32), self.rate

    def close(self) -> None:
        return None


_backend: Backend | None = None


def backend() -> Backend:
    global _backend
    if _backend is None:
        py = os.environ.get("TH_LIVE_TTS_PYTHON")
        _backend = WorkerKokoro(py) if py else InProcessKokoro()
    return _backend


def set_backend(b: Backend | None) -> None:
    global _backend
    if _backend is not None and _backend is not b:
        _backend.close()
    _backend = b


async def speak(text: str) -> AsyncIterator[tuple[np.ndarray, int]]:
    """float32 mono chunks and their sample rate, one per sentence as soon as it is synthesised
    (followed by a short gap inside a multi-sentence text)."""
    b = backend()
    parts = sentences(text)
    for i, s in enumerate(parts):
        samples, rate = await asyncio.to_thread(b.synth, s)
        if i < len(parts) - 1:
            samples = np.concatenate([samples, np.zeros(int(rate * SENTENCE_GAP_S), np.float32)])
        yield samples, rate
