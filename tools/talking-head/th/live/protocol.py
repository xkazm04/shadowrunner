"""Wire protocol `fhl/1` (design.md "Wire protocol"): message builders, binary codecs and the origin
check. Pure functions over bytes and dicts, no I/O, so the server, the bench and the tests share them.

Binary is little-endian:
- 0x01 video:  float64 ptsMs, uint16 width, uint16 height, JPEG bytes
- 0x02 audio:  float64 ptsMs, uint32 sampleRate, PCM16LE mono samples
- 0x03 slide:  uint32 index, image bytes (none: clear the slide)
- 0x10 mic (client): PCM16LE mono 16 kHz
- 0x13 slide image (client): image bytes, after a JSON `slide` command; empty clears the slide
"""

from __future__ import annotations

import json
import re
import struct
from typing import Any, Iterable

import numpy as np

PROTO = "fhl/1"
PATH = "/live"
HEALTH_PATH = "/health"
FPS = 25
FRAME_MS = 40.0
JPEG_QUALITY = 90
CLOSE_ORIGIN = 4403

TAG_VIDEO = 0x01
TAG_AUDIO = 0x02
TAG_SLIDE = 0x03
TAG_MIC = 0x10
TAG_SLIDE_IN = 0x13

MIC_RATE = 16000
EVENT_KINDS = ("line-start", "line-end", "reply-text", "slide", "error")
SOURCES = ("text", "mic")
ROLES = ("control", "out")

_VIDEO_HEAD = struct.Struct("<BdHH")
_AUDIO_HEAD = struct.Struct("<BdI")
_SLIDE_HEAD = struct.Struct("<BI")
_LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")


def health_body() -> bytes:
    return json.dumps({"ok": True, "proto": PROTO}, separators=(",", ":")).encode()


def origin_allowed(origin: str | None, extra: Iterable[str] = ()) -> bool:
    """Local origins (http://localhost:*, http://127.0.0.1:*) and each --allow-origin pass. A client
    that sends no Origin (not a browser: a local script, OBS's own socket) is a local process and
    passes; every browser sends one."""
    if origin is None:
        return True
    o = origin.strip().rstrip("/")
    return bool(_LOCAL.match(o)) or o in {e.strip().rstrip("/") for e in extra}


# ---- server -> client, binary -------------------------------------------------------------------


def video(pts_ms: float, width: int, height: int, jpeg: bytes) -> bytes:
    return _VIDEO_HEAD.pack(TAG_VIDEO, float(pts_ms), width, height) + jpeg


def audio(pts_ms: float, rate: int, pcm16: bytes) -> bytes:
    return _AUDIO_HEAD.pack(TAG_AUDIO, float(pts_ms), rate) + pcm16


def slide(index: int, image: bytes) -> bytes:
    return _SLIDE_HEAD.pack(TAG_SLIDE, index) + image


def parse_binary(msg: bytes) -> dict[str, Any]:
    """Decode any fhl/1 binary message (both directions); used by tests and debugging clients."""
    tag = msg[0]
    if tag == TAG_VIDEO:
        _, pts, w, h = _VIDEO_HEAD.unpack_from(msg)
        return {"tag": tag, "pts": pts, "width": w, "height": h, "jpeg": msg[_VIDEO_HEAD.size:]}
    if tag == TAG_AUDIO:
        _, pts, rate = _AUDIO_HEAD.unpack_from(msg)
        pcm = np.frombuffer(msg[_AUDIO_HEAD.size:], "<i2")
        return {"tag": tag, "pts": pts, "rate": rate, "pcm": pcm}
    if tag == TAG_SLIDE:
        _, index = _SLIDE_HEAD.unpack_from(msg)
        return {"tag": tag, "index": index, "image": msg[_SLIDE_HEAD.size:]}
    if tag == TAG_MIC:
        return {"tag": tag, "pcm": np.frombuffer(msg[1:len(msg) - (len(msg) - 1) % 2], "<i2")}
    if tag == TAG_SLIDE_IN:
        return {"tag": tag, "image": msg[1:]}
    raise ValueError(f"unknown fhl/1 binary tag 0x{tag:02x}")


def mic(pcm16: bytes) -> bytes:
    return bytes([TAG_MIC]) + pcm16


def slide_in(image: bytes) -> bytes:
    return bytes([TAG_SLIDE_IN]) + image


# ---- server -> client, JSON ---------------------------------------------------------------------


def dumps(msg: dict[str, Any]) -> str:
    return json.dumps(msg, separators=(",", ":"))


def state(*, ready: bool, upscale: str, source: str, queue: int, delay_ms: int | None, size: int,
          model: str = "lite") -> dict[str, Any]:
    return {"type": "state", "ready": ready, "model": model, "fps": FPS, "upscale": upscale,
            "source": source, "queue": queue, "delayMs": delay_ms, "size": size}


def event(kind: str, at_ms: float, id: str | None = None, text: str | None = None) -> dict[str, Any]:
    assert kind in EVENT_KINDS, kind
    return {"type": "event", "kind": kind, "id": id, "text": text, "atMs": round(float(at_ms), 3)}


def timing(id: str, first_frame_ms: float | None, chunk_ms: float | None,
           upscale_ms: float | None) -> dict[str, Any]:
    r = lambda v: None if v is None else round(float(v), 1)  # noqa: E731
    return {"type": "timing", "id": id, "firstFrameMs": r(first_frame_ms), "chunkMs": r(chunk_ms),
            "upscaleMs": r(upscale_ms)}


# ---- client -> server, JSON ---------------------------------------------------------------------


class BadCommand(ValueError):
    pass


def parse_command(text: str) -> dict[str, Any]:
    """Validate one client JSON command; raises BadCommand with a message for the error event."""
    try:
        msg = json.loads(text)
    except json.JSONDecodeError as e:
        raise BadCommand(f"not JSON: {e.msg}") from None
    if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
        raise BadCommand("a command is a JSON object with a string 'type'")
    t = msg["type"]
    if t == "hello":
        if msg.get("role") not in ROLES:
            raise BadCommand(f"hello.role must be one of {ROLES}")
    elif t in ("say", "chat"):
        if not isinstance(msg.get("id"), str) or not isinstance(msg.get("text"), str):
            raise BadCommand(f"{t} needs string 'id' and 'text'")
        if not msg["text"].strip():
            raise BadCommand(f"{t}.text is empty")
    elif t == "source":
        if msg.get("source") not in SOURCES:
            raise BadCommand(f"source.source must be one of {SOURCES}")
    elif t == "upscale":
        if not isinstance(msg.get("kind"), str):
            raise BadCommand("upscale needs a string 'kind'")
    elif t == "slide":
        if not isinstance(msg.get("index"), int) or isinstance(msg.get("index"), bool) or msg["index"] < 0:
            raise BadCommand("slide.index must be a non-negative integer")
    elif t != "stop":
        raise BadCommand(f"unknown command type {t!r}")
    return msg


def pcm16(samples: np.ndarray) -> bytes:
    """float32 [-1, 1] -> PCM16LE bytes."""
    return (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
