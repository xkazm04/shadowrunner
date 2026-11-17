"""The test line, spoken by Iris's Kokoro voice exactly as `th audio` speaks a script (same model,
voice, sentence gap and 0.3 s lead/tail), into the experiment's output folder."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ...audio import LANG, MODEL_FILE, SENTENCE_GAP_S, SPEED, VOICE, VOICES_FILE, paragraphs
from ...paths import kokoro_dir

# gesture-friendly: an enumeration ("three things ... speed, privacy, and price") invites counting
# and presenting hands
LINE = ("There are three things I want to show you today: speed, privacy, and price. "
        "Let me walk you through each one.")
LEAD_S = 0.3


def speak(text: str, out: Path) -> float:
    """Synthesise `text` to `out` (PCM16 wav at Kokoro's rate); returns its duration in seconds."""
    import soundfile as sf
    from kokoro_onnx import Kokoro

    models = kokoro_dir()
    kokoro = Kokoro(str(models / MODEL_FILE), str(models / VOICES_FILE))
    rate = 24000
    chunks: list[np.ndarray] = []
    for para in paragraphs(text):
        for i, sentence in enumerate(para):
            if i:
                chunks.append(np.zeros(int(rate * SENTENCE_GAP_S), np.float32))
            samples, rate = kokoro.create(sentence, voice=VOICE, speed=SPEED, lang=LANG)
            chunks.append(np.asarray(samples, np.float32))
    lead = np.zeros(int(rate * LEAD_S), np.float32)
    audio = np.concatenate([lead, *chunks, lead])
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), audio, rate, subtype="PCM_16")
    out.with_suffix(".txt").write_text(text, encoding="utf-8")
    return len(audio) / rate
