"""Lines in, audio segments out: the FIFO of say/chat lines between the commands and the engine.

One producer task speaks one line at a time (Kokoro sentence by sentence, so the first sentence
reaches the engine while the rest is still being synthesised). A chat line streams its sentences
from `th.live.chat.reply_sentences`; each sentence carries a `reply-text` event that the engine emits
at the pts of that sentence's first sample. Shared by the server and `live-bench`.
"""

from __future__ import annotations

import asyncio
import collections
import contextlib
import sys
import time
from typing import AsyncIterator, Callable

from . import protocol as P
from .engine import Engine, Line, Segment
from .tts import to_16k

SpeakFn = Callable[[str], AsyncIterator]
ChatFn = Callable[[str, list[dict]], AsyncIterator[str]]
HISTORY_MAX = 20  # messages (10 turns); the chat module may cap further


class Speaker:
    def __init__(self, engine: Engine, speak: SpeakFn, chat: ChatFn | None = None) -> None:
        self.engine = engine
        self.speak = speak
        self.chat_fn = chat
        self.history: list[dict] = []
        self.log: list[Line] = []
        self._pending: collections.deque[tuple[Line, str, str]] = collections.deque()
        self._active: tuple[Line, str, str] | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._produce(), name="speaker")

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def say(self, id: str, text: str) -> Line:
        return self._add(id, text, "say")

    def chat(self, id: str, text: str) -> Line:
        """A new chat cancels the running (or queued) reply first."""
        old = {ln.id for ln, _, kind in self._items() if kind == "chat"}
        if old:
            self.cancel(old)
        return self._add(id, text, "chat")

    def cancel(self, ids: set[str] | None = None) -> None:
        """Drop queued and speaking lines (all, or those in `ids`) and their unsent audio."""
        self._pending = collections.deque(it for it in self._pending if ids is not None and it[0].id not in ids)
        active = self._active
        if active and (ids is None or active[0].id in ids) and self._task:
            self._task.cancel()
            self._active = None
            self._task = asyncio.create_task(self._produce(), name="speaker")
        self.engine.stop(ids)

    def _items(self) -> list[tuple[Line, str, str]]:
        return ([self._active] if self._active else []) + list(self._pending)

    def _add(self, id: str, text: str, kind: str) -> Line:
        line = Line(id, text, kind=kind)
        self.engine.open_line(line)
        self.log.append(line)
        self._pending.append((line, text, kind))
        self._wake.set()
        self.engine.sink("state", None)
        return line

    async def _produce(self) -> None:
        while True:
            while not self._pending:
                self._wake.clear()
                await self._wake.wait()
            item = self._pending.popleft()
            self._active = item
            line, text, kind = item
            try:
                if kind == "chat":
                    await self._speak_chat(line, text)
                else:
                    await self._speak(line, text, None)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # a TTS or LLM failure ends the line, never the stream
                print(f"th live: line {line.id} failed: {e!r}", file=sys.stderr)
                self.engine.sink("event", P.event("error", max(0.0, self.engine.now_ms()), line.id,
                                                  f"{kind} failed: {e}"))
            finally:
                if self._active is item:
                    self._active = None
                self.engine.close_line(line)

    async def _speak(self, line: Line, text: str, reply: str | None) -> None:
        t0 = time.perf_counter()
        first = True
        async for samples, rate in self.speak(text):
            if line.tts_first_ms is None:
                line.tts_first_ms = (time.perf_counter() - line.received) * 1000
            if first:
                print(f"th live: tts first chunk {(time.perf_counter() - t0) * 1000:.0f} ms "
                      f"({line.id})", file=sys.stderr)
            events = [("reply-text", reply)] if (reply is not None and first) else []
            self.engine.enqueue(Segment(line, to_16k(samples, rate), samples, rate, events))
            first = False

    async def _speak_chat(self, line: Line, text: str) -> None:
        assert self.chat_fn is not None, "no chat module"
        spoken: list[str] = []
        history = list(self.history)
        try:
            gen = self.chat_fn(text, history)
            async with contextlib.aclosing(gen):
                async for sentence in gen:
                    if line.reply_first_ms is None:
                        line.reply_first_ms = (time.perf_counter() - line.received) * 1000
                    if sentence.strip():
                        await self._speak(line, sentence, sentence)
                        spoken.append(sentence)
        finally:  # also on cancel: the history keeps what Iris actually said
            self.history += [{"role": "user", "content": text},
                             {"role": "assistant", "content": " ".join(spoken) or "..."}]
            del self.history[:-HISTORY_MAX]
