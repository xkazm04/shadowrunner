"""fhl/1 codecs, origin rule and command validation; the engine's audio timeline (no GPU)."""

from __future__ import annotations

import json
import struct
import time

import numpy as np
import pytest

from th.live import protocol as P
from th.live.engine import Engine, Line, Segment
from th.live.models import SLICE_SAMPLES, FakeModel, bust_crop
from th.live.tts import FakeTts, sentences, to_16k


def test_binary_layouts_byte_for_byte():
    v = P.video(80.0, 512, 512, b"JPEG")
    assert v == b"\x01" + struct.pack("<d", 80.0) + struct.pack("<HH", 512, 512) + b"JPEG"
    a = P.audio(12.5, 24000, b"\x01\x00\xff\xff")
    assert a == b"\x02" + struct.pack("<d", 12.5) + struct.pack("<I", 24000) + b"\x01\x00\xff\xff"
    s = P.slide(7, b"PNG")
    assert s == b"\x03" + struct.pack("<I", 7) + b"PNG"
    assert P.parse_binary(v)["pts"] == 80.0 and P.parse_binary(v)["jpeg"] == b"JPEG"
    assert P.parse_binary(a)["pcm"].tolist() == [1, -1]
    assert P.parse_binary(s)["index"] == 7
    assert P.parse_binary(P.mic(b"\x02\x00"))["pcm"].tolist() == [2]
    assert P.parse_binary(P.slide_in(b"x"))["image"] == b"x"
    with pytest.raises(ValueError):
        P.parse_binary(b"\x7f")


def test_video_alpha_layout_byte_for_byte():
    m = P.video_alpha(120.0, 1024, 1024, b"RGBJPEG", b"AJPG")
    assert m == (b"\x04" + struct.pack("<d", 120.0) + struct.pack("<HH", 1024, 1024)
                 + struct.pack("<I", 7) + b"RGBJPEG" + b"AJPG")
    assert len(m) == 1 + 8 + 2 + 2 + 4 + 7 + 4
    d = P.parse_binary(m)
    assert (d["tag"], d["pts"], d["width"], d["height"]) == (4, 120.0, 1024, 1024)
    assert d["jpeg"] == b"RGBJPEG" and d["alpha"] == b"AJPG"


def test_json_messages_keep_every_key():
    st = P.state(ready=False, upscale="none", source="text", queue=0, delay_ms=None, size=512)
    assert set(st) == {"type", "ready", "model", "fps", "upscale", "source", "queue", "delayMs", "size",
                       "matte", "idle"}
    assert st["delayMs"] is None and st["fps"] == 25
    assert st["matte"] is False and st["idle"] == "live"  # round 2 keys, always present
    assert P.state(ready=True, upscale="none", source="text", queue=0, delay_ms=1, size=512,
                   matte=True, idle="loop")["idle"] == "loop"
    ev = P.event("line-start", 960.0, "a")
    assert ev == {"type": "event", "kind": "line-start", "id": "a", "text": None, "atMs": 960.0}
    t = P.timing("a", 1234.56, 650.04, None)
    assert t == {"type": "timing", "id": "a", "firstFrameMs": 1234.6, "chunkMs": 650.0, "upscaleMs": None}
    assert json.loads(P.health_body()) == {"ok": True, "proto": "fhl/1"}


@pytest.mark.parametrize("origin,ok", [
    ("http://localhost:5320", True), ("http://127.0.0.1:8080", True), ("http://localhost", True),
    (None, True), ("http://evil.example", False), ("https://localhost:5320", False),
    ("http://localhost.evil.example", False), ("http://studio.lan:3000", True),
])
def test_origin_rule(origin, ok):
    assert P.origin_allowed(origin, ["http://studio.lan:3000"]) is ok


def test_commands_validated():
    assert P.parse_command('{"type":"say","id":"1","text":"hi"}')["text"] == "hi"
    assert P.parse_command('{"type":"matte","on":true}')["on"] is True
    for bad in ('{"type":"matte"}', '{"type":"matte","on":1}', '{"type":"matte","on":"yes"}',
                'nope', '[]', '{"type":"say","id":1,"text":"x"}', '{"type":"say","id":"1","text":" "}',
                '{"type":"hello","role":"admin"}', '{"type":"slide","index":-1}',
                '{"type":"slide","index":true}', '{"type":"source","source":"camera"}', '{"type":"dance"}'):
        with pytest.raises(P.BadCommand):
            P.parse_command(bad)


def test_tts_helpers():
    assert sentences("Hi there.  How are you?\nFine!") == ["Hi there.", "How are you?", "Fine!"]
    x, rate = FakeTts().synth("hello")
    assert rate == 24000 and x.dtype == np.float32
    y = to_16k(x, rate)
    assert abs(len(y) - len(x) * 2 / 3) <= 1


def test_bust_crop_is_640_square(tmp_path):
    from PIL import Image

    out = bust_crop(out=tmp_path / "bust.png")
    assert Image.open(out).size == (640, 640)


def _engine(events: list) -> Engine:
    e = Engine(FakeModel(size=16, compute_s=0), lambda k, p: events.append((k, p)))
    e._t0 = time.perf_counter()
    return e


def test_timeline_pts_line_events_and_sample_conservation():
    ev: list = []
    e = _engine(ev)
    ln = Line("l1", "hi")
    e.open_line(ln)
    play = np.linspace(-0.5, 0.5, 30000, dtype=np.float32)  # 1.25 s at 24 kHz
    e.enqueue(Segment(ln, to_16k(play, 24000), play, 24000, [("reply-text", "hi")]))
    e.close_line(ln)
    _, a0, e0, s0, _ = e._take_slice(0.0)
    _, a1, e1, s1, _ = e._take_slice(960.0)
    assert [x["kind"] for x in e0] == ["line-start", "reply-text"] and e0[0]["atMs"] == 0.0
    assert s0 == [ln] and not s1
    assert a0[0][0] == 0.0 and a1[0][0] == 960.0
    assert sum(len(a[2]) for a in a0 + a1) == len(play)  # every sample sent once
    assert np.array_equal(np.concatenate([a0[0][2], a1[0][2]]), play)
    end = [x for x in e1 if x["kind"] == "line-end"]
    assert end and abs(end[0]["atMs"] - 1250.0) < 0.1
    assert e.queue_len == 1  # still counted until the chunk carrying its line-end is emitted


def test_line_spoken_after_idle_starts_mid_stream_and_stop_drops_it():
    ev: list = []
    e = _engine(ev)
    e._take_slice(0.0)  # idle chunk: nothing sent
    ln = Line("l2", "x")
    e.open_line(ln)
    pcm = np.ones(4000, np.float32) * 0.1
    e.enqueue(Segment(ln, pcm, pcm, 16000))
    e.enqueue(Segment(ln, pcm, pcm, 16000))
    buf, audio, events, _, _ = e._take_slice(960.0)
    assert events[0]["atMs"] == 960.0 and audio[0][0] == 960.0 and audio[1][0] == 1210.0
    assert buf[:8000].min() == pytest.approx(0.1) and buf[8000:].max() == 0
    e.enqueue(Segment(ln, pcm, pcm, 16000))
    cut = e.stop()
    assert cut == [ln] and ln.cut
    ends = [p for k, p in ev if k == "event" and p["kind"] == "line-end"]
    assert [(x["id"], x["text"]) for x in ends] == [("l2", "stopped")]
    _, audio, events, _, _ = e._take_slice(1920.0)
    assert not audio and not events


def test_mic_backlog_is_bounded():
    e = _engine([])
    e.set_source("mic")
    pcm = np.zeros(1600, np.float32)
    for _ in range(40):  # 4 s arrives while the engine is busy
        e.enqueue(Segment(None, pcm, pcm, 16000))
    assert sum(len(s.pcm16k) for s in e._fifo) <= 2 * SLICE_SAMPLES
    _, audio, _, _, _ = e._take_slice(0.0)
    assert len(audio) == 1 and len(audio[0][2]) == SLICE_SAMPLES  # mic packets coalesce per chunk


def test_upscaler_that_fails_to_load_or_run_falls_back_to_none(monkeypatch):
    import th.live.stages as eng

    real = eng.get_upscaler

    class Broken:
        kind, scale = "maxine", 2

        def warmup(self) -> None:
            return None

        def __call__(self, frames):
            raise RuntimeError("sdk lost")

    def fake_get(kind: str):
        if kind == "maxine":
            raise RuntimeError("nvidia-vfx is not installed")
        return Broken() if kind == "realesrgan" else real(kind)

    monkeypatch.setattr(eng, "get_upscaler", fake_get)
    ev: list = []
    e = Engine(FakeModel(size=16, compute_s=0), lambda k, p: ev.append((k, p)), upscale="maxine")
    e.start()
    try:
        t = time.time() + 5
        while not e.ready and time.time() < t:
            time.sleep(0.02)
        assert e.ready and e.upscaler.kind == "none" and e.error is None
        errors = [p["text"] for k, p in ev if k == "event" and p["kind"] == "error"]
        assert errors == ["upscale maxine: nvidia-vfx is not installed"]
        e._swap_upscaler(Broken())  # loads, then fails on a chunk (Broken needs no CUDA to raise)
        e._pending_up = None
        monkeypatch.setattr("torch.cuda.synchronize", lambda: None)
        e._compute(5)
        assert e.upscaler.kind == "none"
        assert any("failed, using none: sdk lost" in p["text"] for k, p in ev if k == "event")
    finally:
        e.close()
