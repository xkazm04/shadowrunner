"""Kokoro over JSON lines on stdio (Avatar Lab voice sidecar).

    python -m lab_voice.server --models <dir>

``<dir>`` holds ``kokoro-v1.0.onnx`` and ``voices-v1.0.bin`` (``pnpm lab setup`` fetches them into
``var/lab/models/``). Once the model is loaded one line ``{"ready": true, "visemeSource": ...}`` is
written. Then each request line ``{"id", "text", "voice"}`` gets one response line
``{"id", "sampleRate", "pcmBase64", "visemes": [{"v", "startMs", "endMs"}], "visemeSource"}``
(PCM is s16le mono) or ``{"id", "error"}``. Diagnostics go to stderr only; stdout is the protocol.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

from .visemes import spans, uniform

MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"


def _pcm16(audio: Any) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


class Voice:
    def __init__(self, models: Path) -> None:
        from kokoro_onnx import Kokoro

        self.kokoro = Kokoro(str(models / MODEL_FILE), str(models / VOICES_FILE))
        self.source = "durations" if self.kokoro.has_timings else "uniform"

    def speak(self, text: str, voice: str) -> dict[str, Any]:
        audio, rate, timed = self.kokoro.create_timed(text, voice)
        duration_s = len(audio) / rate
        if timed:
            visemes = spans((t.phoneme, t.start, t.end) for t in timed)
            source = "durations"
        else:
            phonemes = list(self.kokoro.tokenizer.phonemize(text, "en-us"))
            visemes = uniform(phonemes, duration_s)
            source = "uniform"
        return {
            "sampleRate": rate,
            "pcmBase64": base64.b64encode(_pcm16(audio)).decode("ascii"),
            "visemes": [s.to_json() for s in visemes],
            "visemeSource": source,
        }


def _write(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def serve(voice: Voice) -> None:
    # One throwaway line first: onnxruntime's first run is several times slower than the rest, and
    # that warm-up would otherwise land in the first turn's latency.
    voice.speak("Ready.", "bm_lewis")
    _write({"ready": True, "visemeSource": voice.source})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid: Any = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            text, name = req.get("text"), req.get("voice")
            if not isinstance(rid, str) or not isinstance(text, str) or not isinstance(name, str):
                raise ValueError("a request needs string id, text and voice")
            _write({"id": rid, **voice.speak(text, name)})
        except Exception as error:  # one bad line must not end the sidecar
            _write({"id": rid, "error": f"{type(error).__name__}: {error}"})


def main() -> None:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", required=True, type=Path)
    args = parser.parse_args()
    for name in (MODEL_FILE, VOICES_FILE):
        if not (args.models / name).is_file():
            sys.stderr.write(f"lab-voice: {args.models / name} is missing; run `pnpm lab setup`.\n")
            sys.exit(2)
    serve(Voice(args.models))


if __name__ == "__main__":
    main()
