"""Kokoro worker for the live server (`python -m th.live.tts_worker`, core th env; see tts.py).

stdin: one JSON object per line, {"text": "<sentence>"}. stdout: '<II' (0, 0) once the model is
loaded, then per request '<II' (n samples, rate) + n float32 LE samples. Everything else (logs,
upstream prints) goes to stderr: fd 1 is pointed at stderr before anything is imported.
"""

from __future__ import annotations

import json
import os
import struct
import sys


def main() -> int:
    out = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    import numpy as np

    from .tts import InProcessKokoro

    k = InProcessKokoro()
    k.warmup()
    k.synth("Ready.")  # onnxruntime's first run is slow (~1 s); pay it before the first line
    out.write(struct.pack("<II", 0, 0))
    out.flush()
    for line in sys.stdin.buffer:
        if not line.strip():
            continue
        text = json.loads(line)["text"]
        try:
            samples, rate = k.synth(text)
        except Exception as e:  # a bad sentence answers with silence, never kills the worker
            print(f"tts worker: {e!r} on {text!r}", file=sys.stderr, flush=True)
            samples, rate = np.zeros(0, np.float32), 24000
        data = np.ascontiguousarray(samples, "<f4")
        out.write(struct.pack("<II", data.size, rate) + data.tobytes())
        out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
