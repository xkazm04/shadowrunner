"""The fhl/1 server end to end on port 8766: a Python WebSocket client as control + out against the
real engine loop, with the fake model (frames whose mouth brightness follows the audio) and the fake
voice. Real time: each test streams a few seconds."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import time
import urllib.request

import numpy as np
import pytest
from PIL import Image
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from th.live import protocol as P
from th.live.engine import Engine
from th.live.models import FakeModel
from th.live.server import LiveServer, run
from th.live.tts import FakeTts, speak, set_backend

PORT = 8766
URI = f"ws://127.0.0.1:{PORT}/live"
LOCAL = "http://localhost:5320"


REPLY = ("First sentence here, and it runs on for quite a while longer.", "And a second one.")


async def fake_chat(text: str, history: list[dict]):
    for s in REPLY:
        await asyncio.sleep(0.05)
        yield s


@contextlib.asynccontextmanager
async def live_server(**engine_kw):
    set_backend(FakeTts(ms_per_char=40))
    server = LiveServer(["http://allowed.example"])
    engine = Engine(FakeModel(size=32, compute_s=0.02), server.sink, **engine_kw)
    server.attach(engine, speak, fake_chat)
    started, stop = asyncio.Event(), asyncio.Event()
    task = asyncio.create_task(run(server, engine, PORT, started=started, stop=stop))
    await asyncio.wait_for(started.wait(), 10)
    try:
        yield server, engine
    finally:
        stop.set()
        await asyncio.wait_for(task, 15)
        set_backend(None)


class Inbox:
    """Everything one client receives, decoded, with its arrival time."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.items: list[tuple[float, dict]] = []
        self.task = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        with contextlib.suppress(ConnectionClosed):
            async for m in self.ws:
                d = P.parse_binary(m) if isinstance(m, bytes) else json.loads(m)
                self.items.append((time.perf_counter(), d))

    def json(self, **match) -> list[dict]:
        return [d for _, d in self.items if "type" in d and all(d.get(k) == v for k, v in match.items())]

    def binary(self, tag: int) -> list[dict]:
        return [d for _, d in self.items if d.get("tag") == tag]

    async def until(self, timeout: float = 15, **match) -> dict:
        t = time.perf_counter() + timeout
        while time.perf_counter() < t:
            found = self.json(**match)
            if found:
                return found[0]
            await asyncio.sleep(0.02)
        raise AssertionError(f"no message {match} in {timeout} s; got {[d for _, d in self.items if 'type' in d]}")


async def clients():
    ctl = await connect(URI, origin=LOCAL)
    out = await connect(URI, origin=LOCAL)
    await ctl.send(json.dumps({"type": "hello", "role": "control"}))
    await out.send(json.dumps({"type": "hello", "role": "out"}))
    return ctl, Inbox(ctl), out, Inbox(out)


def mouth(jpeg: bytes) -> float:
    a = np.asarray(Image.open(io.BytesIO(jpeg)).convert("L"), np.float32)
    return float(a[18:22, 10:22].mean())  # the fake model's mouth box, away from the tick row


def test_say_line_start_matches_first_audio_pts_frames_follow_the_audio():
    async def go():
        async with live_server():
            ctl, cin, out, oin = await clients()
            await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "say", "id": "l1", "text": "Hello there, this is a sync test."}))
            start = await oin.until(type="event", kind="line-start", id="l1")
            end = await oin.until(type="event", kind="line-end", id="l1")
            timing = await cin.until(type="timing", id="l1")
            await asyncio.sleep(0.3)
            audio = oin.binary(P.TAG_AUDIO)
            video = oin.binary(P.TAG_VIDEO)
            await ctl.close()
            await out.close()
            return start, end, timing, audio, video, cin

    start, end, timing, audio, video, cin = asyncio.run(go())
    assert audio and audio[0]["rate"] == 24000
    assert audio[0]["pts"] == pytest.approx(start["atMs"], abs=1e-3)  # line-start = first sample
    expect = FakeTts(ms_per_char=40).synth("Hello there, this is a sync test.")[0]
    total = sum(len(a["pcm"]) for a in audio)
    assert total == len(expect)  # every sample once, nothing else (silence is never sent)
    last = audio[-1]
    assert last["pts"] + len(last["pcm"]) / 24 == pytest.approx(end["atMs"], abs=0.1)
    pts = [v["pts"] for v in video]
    assert pts == [40.0 * i for i in range(int(pts[0] / 40), int(pts[0] / 40) + len(pts))]  # contiguous
    assert all(v["width"] == 32 and v["height"] == 32 for v in video)
    # lip-sync by construction: frames inside the line show the mouth, frames before it do not
    inside = [mouth(v["jpeg"]) for v in video if start["atMs"] + 200 <= v["pts"] < end["atMs"] - 200]
    before = [mouth(v["jpeg"]) for v in video if v["pts"] < start["atMs"] - 40]
    assert inside and before and np.mean(inside) > np.mean(before) + 20
    assert timing["firstFrameMs"] > 0 and timing["chunkMs"] is not None and timing["upscaleMs"] is None
    states = cin.json(type="state")
    assert states[0]["ready"] in (True, False) and {s["queue"] for s in states} >= {0, 1}
    assert all(isinstance(s["delayMs"], int) for s in states)


def test_stop_mid_line_cuts_speech_within_one_chunk():
    async def go():
        async with live_server():
            ctl, cin, out, oin = await clients()
            await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "say", "id": "long", "text": "word " * 60 + "end."}))
            await oin.until(type="event", kind="line-start", id="long")
            await asyncio.sleep(0.8)
            t_stop = time.perf_counter()
            await ctl.send(json.dumps({"type": "stop"}))
            end = await oin.until(type="event", kind="line-end", id="long")
            await asyncio.sleep(2.5)
            late = [d for t, d in oin.items if d.get("tag") == P.TAG_AUDIO and t > t_stop + 0.96]
            frames_after = [d for t, d in oin.items if d.get("tag") == P.TAG_VIDEO and t > t_stop + 1.5]
            q = cin.json(type="state")[-1]["queue"]
            await ctl.close()
            await out.close()
            return end, late, frames_after, q

    end, late, frames_after, queue = asyncio.run(go())
    assert end["text"] == "stopped"
    assert late == []  # no speech audio more than one chunk after the stop
    assert frames_after  # the stream itself never stops
    assert queue == 0


def test_foreign_origin_is_refused_with_4403_and_health_answers():
    async def go():
        async with live_server():
            with pytest.raises(ConnectionClosed) as e:
                ws = await connect(URI, origin="http://evil.example")
                await asyncio.wait_for(ws.recv(), 5)
            ok = await connect(URI, origin="http://allowed.example")  # --allow-origin
            await ok.send(json.dumps({"type": "hello", "role": "out"}))
            st = json.loads(await asyncio.wait_for(ok.recv(), 5))
            await ok.close()
            body = await asyncio.to_thread(
                lambda: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=5).read())
            return e.value.rcvd.code, st, json.loads(body)

    code, st, health = asyncio.run(go())
    assert code == 4403
    assert st["type"] == "state"
    assert health == {"ok": True, "proto": "fhl/1"}


def test_mic_echo_slide_relay_and_refusals():
    async def go():
        async with live_server():
            ctl, cin, out, oin = await clients()
            await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "source", "source": "mic"}))
            await cin.until(type="state", source="mic")
            await ctl.send(json.dumps({"type": "say", "id": "no", "text": "refused"}))
            err = await cin.until(type="event", kind="error", id="no")
            tone = (0.2 * np.sin(np.arange(16000) / 16000 * 2 * np.pi * 300) * 32767).astype("<i2")
            for k in range(10):  # 1 s of mic, 100 ms packets, in real time
                await ctl.send(P.mic(tone[k * 1600:(k + 1) * 1600].tobytes()))
                await asyncio.sleep(0.1)
            await ctl.send(json.dumps({"type": "slide", "index": 3}))
            await ctl.send(P.slide_in(b"\x89PNG-fake"))
            slide_ev = await oin.until(type="event", kind="slide")
            await ctl.send(json.dumps({"type": "slide", "index": 4}))
            await ctl.send(P.slide_in(b""))  # amendment: an empty image clears the slide
            clear_ev = await oin.until(type="event", kind="slide", text=None)
            await asyncio.sleep(2.5)
            await ctl.send(json.dumps({"type": "upscale", "kind": "bogus"}))
            bad = await cin.until(type="event", kind="error", id=None)
            await ctl.close()
            await out.close()
            return err, slide_ev, clear_ev, oin.binary(P.TAG_AUDIO), oin.binary(P.TAG_SLIDE), bad

    err, slide_ev, clear_ev, audio, slides, bad = asyncio.run(go())
    assert clear_ev["text"] is None and slides[-1]["index"] == 4 and slides[-1]["image"] == b""
    assert "mic" in err["text"]
    assert slide_ev["text"] == "3" and slides and slides[0]["index"] == 3 and slides[0]["image"] == b"\x89PNG-fake"
    assert audio and all(a["rate"] == 16000 for a in audio)
    assert sum(len(a["pcm"]) for a in audio) == 16000  # the mic echoed once, sample for sample
    assert "bogus" in bad["text"] or "upscale" in bad["text"]


def test_chat_reply_text_at_sentence_pts_and_new_chat_cancels():
    async def go():
        async with live_server() as (server, _):
            ctl, cin, out, oin = await clients()
            await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "chat", "id": "c1", "text": "hi"}))
            await oin.until(type="event", kind="line-start", id="c1")
            await ctl.send(json.dumps({"type": "chat", "id": "c2", "text": "again"}))
            cut = await oin.until(type="event", kind="line-end", id="c1")
            await oin.until(type="event", kind="line-end", id="c2", timeout=20)
            await asyncio.sleep(0.3)
            history = list(server.speaker.history)
            await ctl.close()
            await out.close()
            return cut, oin.json(type="event", kind="reply-text"), oin.binary(P.TAG_AUDIO), history

    cut, replies, audio, history = asyncio.run(go())
    assert cut["text"] == "stopped"
    assert {r["id"] for r in replies} <= {"c1", "c2"}  # a chat's events all carry its message id
    c2 = [r for r in replies if r["id"] == "c2"]
    assert [r["text"] for r in c2] == list(REPLY)
    starts = {round(a["pts"], 3) for a in audio}
    assert all(r["atMs"] in starts for r in c2)  # each sentence's text lands on its first sample
    assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"]


# ---- round 2: matte (0x04), state.matte / state.idle, the stop marker ---------------------------


class HalfMatte:
    """Registered for these tests only: the left half of the frame is opaque."""

    kind = "fake-ws"

    def warmup(self) -> None:
        return None

    def __call__(self, frames):
        a = np.zeros(frames.shape[:3], np.uint8)
        a[:, :, : frames.shape[2] // 2] = 255
        return a


def test_matte_command_switches_to_0x04_with_exact_layout_and_back(monkeypatch):
    from th.live import stages
    from th.live.matte import kinds

    monkeypatch.setitem(kinds.KINDS, "fake-ws", HalfMatte)
    monkeypatch.setattr(stages, "MATTE_KIND", "fake-ws")

    async def go():
        async with live_server():
            ctl, cin, out, oin = await clients()
            first = await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "matte", "on": True}))
            on = await cin.until(type="state", matte=True)
            await asyncio.sleep(1.5)
            n_alpha = len(oin.binary(P.TAG_VIDEO_ALPHA))
            await ctl.send(json.dumps({"type": "matte", "on": False}))
            await cin.until(type="state", matte=False, ready=True)
            t_off = time.perf_counter()
            await asyncio.sleep(1.5)
            raw = [d for t, d in oin.items if t > t_off + 0.5 and "tag" in d]
            await ctl.close()
            await out.close()
            return first, on, n_alpha, oin, raw

    first, on, n_alpha, oin, after = asyncio.run(go())
    assert first["matte"] is False and first["idle"] == "live"  # keys always present
    assert on["matte"] is True and n_alpha >= 20
    msgs = oin.binary(P.TAG_VIDEO_ALPHA)
    m = msgs[0]
    assert (m["width"], m["height"]) == (32, 32)
    rgb = Image.open(io.BytesIO(m["jpeg"]))
    alpha = Image.open(io.BytesIO(m["alpha"]))
    assert rgb.mode == "RGB" and rgb.size == (32, 32)
    assert alpha.mode == "L" and alpha.size == (32, 32)
    a = np.asarray(alpha, np.float32)
    assert a[:, :12].mean() > 240 and a[:, 20:].mean() < 15
    # the wire bytes: tag, float64 pts, uint16 w, uint16 h, uint32 rgbLength, rgb JPEG, alpha JPEG
    wire = P.video_alpha(m["pts"], 32, 32, m["jpeg"], m["alpha"])
    assert wire[0] == 0x04 and int.from_bytes(wire[13:17], "little") == len(m["jpeg"])
    assert wire[17:17 + len(m["jpeg"])][:2] == b"\xff\xd8" and wire[17 + len(m["jpeg"]):][:2] == b"\xff\xd8"
    pts = sorted(v["pts"] for v in oin.binary(P.TAG_VIDEO) + msgs)
    assert pts == [pts[0] + 40.0 * i for i in range(len(pts))]  # one stream, no gap or repeat
    assert after and all(d["tag"] != P.TAG_VIDEO_ALPHA for d in after)


def test_missing_matte_kind_one_error_and_matte_stays_false(monkeypatch):
    from th.live import stages

    monkeypatch.setattr(stages, "MATTE_KIND", "absent-kind")

    async def go():
        async with live_server():
            ctl, cin, out, oin = await clients()
            await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "matte", "on": True}))
            err = await cin.until(type="event", kind="error")
            await asyncio.sleep(1.2)
            states = cin.json(type="state")
            errors = cin.json(type="event", kind="error")
            await ctl.close()
            await out.close()
            return err, states, errors, oin.binary(P.TAG_VIDEO_ALPHA)

    err, states, errors, alpha = asyncio.run(go())
    assert "absent-kind" in err["text"] and len(errors) == 1
    assert all(s["matte"] is False for s in states) and alpha == []


def test_idle_loop_state_and_stop_marker():
    loop = np.zeros((10, 32, 32, 3), np.uint8)  # a black idle loop

    async def go():
        async with live_server(loop=loop):
            ctl, cin, out, oin = await clients()
            first = await oin.until(type="state", ready=True)
            await asyncio.sleep(0.5)
            await ctl.send(json.dumps({"type": "say", "id": "s1", "text": "word " * 40 + "end."}))
            live = await cin.until(type="state", idle="live")
            await asyncio.sleep(1.0)
            await ctl.send(json.dumps({"type": "stop"}))
            end = await oin.until(type="event", kind="line-end", id="s1")
            back = await cin.until(type="state", idle="loop", queue=0)
            await asyncio.sleep(0.3)
            await ctl.close()
            await out.close()
            return first, live, end, back, oin.binary(P.TAG_VIDEO)

    first, live, end, back, video = asyncio.run(go())
    assert first["idle"] == "loop"
    assert live["idle"] == "live" and back["idle"] == "loop"
    assert end["text"] == "stopped"  # the out clients' flush signal
    lum = [float(np.asarray(Image.open(io.BytesIO(v["jpeg"])).convert("L")).mean()) for v in video]
    assert min(lum[:5]) < 5 and max(lum) > 50  # the loop (black) first, the live face (grey) later


# ---- round 3: the motion command and state.motion ------------------------------------------------


def test_motion_command_sets_state_motion_and_bad_level_is_refused():
    async def go():
        async with live_server(motion="natural") as (_server, engine):
            ctl, cin, out, oin = await clients()
            first = await oin.until(type="state", ready=True)
            await ctl.send(json.dumps({"type": "motion", "level": "lively"}))
            lively = await cin.until(type="state", motion="lively")
            await ctl.send(json.dumps({"type": "motion", "level": "wild"}))
            err = await cin.until(type="event", kind="error")
            await ctl.send(json.dumps({"type": "motion", "level": "off"}))
            off = await oin.until(type="state", motion="off")
            await asyncio.sleep(1.5)  # the motion eases out within 0.5 s
            n = len(oin.binary(P.TAG_VIDEO))
            await asyncio.sleep(1.2)
            moved_ms = list(engine.stats["motionMs"])
            await ctl.close()
            await out.close()
            return first, lively, err, off, n, moved_ms, engine.motion.level

    first, lively, err, off, n, moved_ms, level = asyncio.run(go())
    assert first["motion"] == "natural"  # key always present
    assert lively["motion"] == "lively" and off["motion"] == "off" and level == "off"
    assert "motion.level" in err["text"]
    assert moved_ms and n > 0  # frames were warped while on, and the stream kept flowing
