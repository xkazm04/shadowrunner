"""The `fhl/1` WebSocket server: ws://127.0.0.1:<port>/live plus GET /health on the same port.

Every client says hello first. `out` clients receive media (binary) plus all JSON; `control`
clients send commands and receive all JSON. Each client has its own sender task and queue, so one
slow viewer never blocks the engine or the others; a viewer that falls over SLOW_CLIENT_MSGS
behind has binary messages dropped (JSON always goes through).
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np

from . import protocol as P
from .engine import Chunk, Engine, Segment
from .speaker import ChatFn, Speaker, SpeakFn
from .upscale import KINDS

SLOW_CLIENT_MSGS = 300
MAX_MESSAGE = 16 * 1024 * 1024  # a slide image


@dataclass(eq=False)
class Client:
    ws: Any
    role: str | None = None
    q: asyncio.Queue = field(default_factory=asyncio.Queue)
    slide_index: int | None = None
    dropped: int = 0


class LiveServer:
    def __init__(self, allow_origins: Iterable[str] = ()) -> None:
        self.allow = tuple(allow_origins)
        self.clients: set[Client] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.engine: Engine | None = None
        self.speaker: Speaker | None = None
        self._last_state: str | None = None

    def attach(self, engine: Engine, speak: SpeakFn, chat: ChatFn | None) -> None:
        self.engine = engine
        self.speaker = Speaker(engine, speak, chat)

    # ---- engine side (any thread) ----------------------------------------------------------------

    def sink(self, kind: str, payload: Any) -> None:
        loop = self.loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._on_sink, kind, payload)

    def _on_sink(self, kind: str, payload: Any) -> None:
        if kind == "chunk":
            self._emit_chunk(payload)
        elif kind == "event":
            self._send_all(P.dumps(payload))
        elif kind == "state":
            self._send_state()

    def _emit_chunk(self, c: Chunk) -> None:
        for e in c.events:
            self._send_all(P.dumps(e))
        for pts, rate, samples, _line in c.audio:
            self._send_out(P.audio(pts, rate, P.pcm16(samples)))
        for i, jpeg in enumerate(c.frames):
            pts = c.pts_ms + i * P.FRAME_MS
            if isinstance(jpeg, tuple):  # matting on: colour + alpha
                self._send_out(P.video_alpha(pts, c.width, c.height, jpeg[0], jpeg[1]))
            else:
                self._send_out(P.video(pts, c.width, c.height, jpeg))
        now = time.perf_counter()
        for ln in c.starts:
            ln.first_frame_ms = (now - ln.received) * 1000
            self._send_all(P.dumps(P.timing(ln.id, ln.first_frame_ms, c.chunk_ms, c.upscale_ms)))
            llm = f"llm first sentence {ln.reply_first_ms:.0f} ms, " if ln.reply_first_ms else ""
            print(f"th live: {ln.kind} {ln.id}: firstFrame {ln.first_frame_ms:.0f} ms, {llm}tts first "
                  f"{ln.tts_first_ms or 0:.0f} ms, starts at {ln.start_ms:.0f} ms "
                  f"(+{ln.start_ms - ln.received_ms:.0f} ms), chunk {c.chunk_ms:.0f} ms", file=sys.stderr)

    def state_msg(self) -> str:
        e = self.engine
        assert e is not None
        return P.dumps(P.state(ready=e.ready, upscale=e.upscaler.kind, source=e.source,
                               queue=e.queue_len, delay_ms=e.delay_ms(), size=e.size, model=e.model.name,
                               matte=e.matte is not None, idle=e.idle_mode))

    def _send_state(self) -> None:
        s = self.state_msg()
        if s != self._last_state:
            self._last_state = s
            self._send_all(s)

    def _send_all(self, msg: str) -> None:
        for c in self.clients:
            if c.role is not None:
                c.q.put_nowait(msg)

    def _send_out(self, msg: bytes) -> None:
        for c in self.clients:
            if c.role == "out":
                if c.q.qsize() > SLOW_CLIENT_MSGS:
                    c.dropped += 1
                else:
                    c.q.put_nowait(msg)

    # ---- connections -----------------------------------------------------------------------------

    def process_request(self, connection, request):
        from websockets.datastructures import Headers
        from websockets.http11 import Response

        path = request.path.split("?", 1)[0]
        if path == P.HEALTH_PATH:
            origin = request.headers.get("Origin")
            headers = [("Content-Type", "application/json"), ("Cache-Control", "no-store")]
            if origin and P.origin_allowed(origin, self.allow):
                headers.append(("Access-Control-Allow-Origin", origin))
            body = P.health_body()
            headers.append(("Content-Length", str(len(body))))
            return Response(200, "OK", Headers(headers), body)
        if path != P.PATH:
            return connection.respond(404, "fhl/1: use /live or /health\n")
        return None

    async def handler(self, ws) -> None:
        if not P.origin_allowed(ws.request.headers.get("Origin"), self.allow):
            await ws.close(P.CLOSE_ORIGIN, "origin not allowed")
            return
        client = Client(ws)
        self.clients.add(client)
        sender = asyncio.create_task(self._sender(client))
        try:
            async for msg in ws:
                if isinstance(msg, bytes):
                    self._on_binary(client, msg)
                else:
                    self._on_text(client, msg)
        except Exception as e:  # a broken client never takes the server down
            if type(e).__name__ not in ("ConnectionClosedError", "ConnectionClosedOK"):
                print(f"th live: client error {e!r}", file=sys.stderr)
        finally:
            self.clients.discard(client)
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sender

    async def _sender(self, client: Client) -> None:
        with contextlib.suppress(Exception):
            while True:
                await client.ws.send(await client.q.get())

    def _error(self, client: Client, text: str, id: str | None = None) -> None:
        e = self.engine
        at = max(0.0, e.now_ms()) if e else 0.0
        client.q.put_nowait(P.dumps(P.event("error", at, id, text)))

    def _on_text(self, client: Client, text: str) -> None:
        try:
            cmd = P.parse_command(text)
        except P.BadCommand as e:
            return self._error(client, str(e))
        t = cmd["type"]
        if t == "hello":
            client.role = cmd["role"]
            client.q.put_nowait(self.state_msg())
            return
        if client.role is None:
            return self._error(client, "send hello first")
        if client.role != "control":
            return self._error(client, "out clients do not send commands")
        e, sp = self.engine, self.speaker
        assert e is not None and sp is not None
        if t in ("say", "chat"):
            if e.source == "mic":
                return self._error(client, f"{t} refused while the source is mic", cmd["id"])
            if t == "chat" and sp.chat_fn is None:
                return self._error(client, "chat is not available", cmd["id"])
            (sp.say if t == "say" else sp.chat)(cmd["id"], cmd["text"])
        elif t == "stop":
            sp.cancel(None)
        elif t == "source":
            if cmd["source"] != e.source:
                sp.cancel(None)
                e.set_source(cmd["source"])
                self._send_state()
        elif t == "upscale":
            if cmd["kind"] not in KINDS:
                return self._error(client, f"unknown upscaler {cmd['kind']!r}; one of {KINDS}")
            if cmd["kind"] != e.upscaler.kind:
                e.set_upscale(cmd["kind"])
        elif t == "matte":
            if cmd["on"] != (e.matte is not None):
                e.set_matte(cmd["on"])
        elif t == "slide":
            client.slide_index = cmd["index"]

    def _on_binary(self, client: Client, msg: bytes) -> None:
        if client.role != "control" or not msg:
            return self._error(client, "binary messages come from control clients")
        e = self.engine
        assert e is not None
        tag = msg[0]
        if tag == P.TAG_MIC:
            if e.source != "mic":
                return  # stray packets after switching back to text are ignored silently
            pcm = P.parse_binary(msg)["pcm"].astype(np.float32) / 32768.0
            if pcm.size:
                e.enqueue(Segment(None, pcm, pcm, P.MIC_RATE))
        elif tag == P.TAG_SLIDE_IN:
            if client.slide_index is None:
                return self._error(client, "slide image without a preceding slide command")
            index, client.slide_index = client.slide_index, None
            image = msg[1:]  # empty: clear the slide (relayed as an empty 0x03, event text null)
            self._send_out(P.slide(index, image))
            self._send_all(P.dumps(P.event("slide", max(0.0, e.now_ms()), None,
                                           str(index) if image else None)))
        else:
            self._error(client, f"unknown binary tag 0x{tag:02x}")


async def run(server: LiveServer, engine: Engine, port: int, host: str = "127.0.0.1",
              started: asyncio.Event | None = None, stop: asyncio.Event | None = None) -> None:
    """Serve until `stop` is set (forever by default). The engine starts after the socket is bound,
    so clients can connect (and see ready:false) while the model loads."""
    from websockets.asyncio.server import serve

    server.loop = asyncio.get_running_loop()
    assert server.speaker is not None
    async with serve(server.handler, host, port, process_request=server.process_request,
                     compression=None, max_size=MAX_MESSAGE, ping_interval=20):
        server.speaker.start()
        engine.start()
        print(f"th live: fhl/1 on ws://{host}:{port}{P.PATH} (health: http://{host}:{port}"
              f"{P.HEALTH_PATH})", file=sys.stderr, flush=True)
        if started:
            started.set()
        try:
            await (stop.wait() if stop else asyncio.Future())
        finally:
            await server.speaker.close()
            await asyncio.to_thread(engine.close)
