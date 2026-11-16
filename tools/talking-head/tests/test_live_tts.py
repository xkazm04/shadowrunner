"""Kokoro for the live server: the worker subprocess (core env) is started once and reused, and
`speak` streams sentence by sentence. Needs the Kokoro files; CPU only."""

from __future__ import annotations

import asyncio
import sys
import time

import numpy as np
import pytest

from th.live import tts
from th.live.models import RATE


def _kokoro() -> bool:
    from th.audio import MODEL_FILE, VOICES_FILE
    from th.paths import kokoro_dir

    return (kokoro_dir() / MODEL_FILE).is_file() and (kokoro_dir() / VOICES_FILE).is_file()


needs_kokoro = pytest.mark.skipif(not _kokoro(), reason="needs the Kokoro files (pnpm lab setup)")


@needs_kokoro
def test_worker_started_once_reused_and_streams_sentences(capsys):
    w = tts.WorkerKokoro(sys.executable)
    tts.set_backend(w)
    try:
        w.warmup()
        pid = w.proc.pid
        assert w.started_ms and w.started_ms > 0

        async def go():
            got, t0 = [], time.perf_counter()
            async for samples, rate in tts.speak("Hello there. This is the second sentence."):
                got.append((samples, rate, (time.perf_counter() - t0) * 1000))
            return got

        got = asyncio.run(go())
        assert len(got) == 2 and all(r == 24000 for _, r, _ in got)
        assert all(s.dtype == np.float32 and len(s) > 24000 * 0.3 for s, _, _ in got)
        assert w.proc.pid == pid  # one worker for every sentence
        x16 = tts.to_16k(got[0][0], 24000)
        assert abs(len(x16) - len(got[0][0]) * RATE // 24000) <= 1
        with capsys.disabled():
            print(f"\nkokoro worker: start {w.started_ms:.0f} ms, first sentence {got[0][2]:.0f} ms, "
                  f"second {got[1][2]:.0f} ms")
    finally:
        tts.set_backend(None)
    assert w.proc is None  # closed with the backend
