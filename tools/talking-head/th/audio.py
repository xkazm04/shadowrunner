"""`th audio`: a script spoken by Kokoro v1.0 (kokoro-onnx, the same model files the Avatar Lab
uses) into $TH_HOME/audio/<script>.wav plus the text beside it. One voice for every arm."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .paths import audio_dir, kokoro_dir, script_path

# Iris speaks "velvet" in her pack (scripts/build-packs.mjs COMPANION_VOICES), which the lab maps
# to Kokoro's af_heart (apps/lab/src/director/voice/kokoro.ts KOKORO_VOICES).
VOICE = "af_heart"
SPEED = 1.0
LANG = "en-us"
SENTENCE_GAP_S = 0.22
PARAGRAPH_GAP_S = 0.6
MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def read_script(script_id: str) -> str:
    return script_path(script_id).read_text(encoding="utf-8").strip()


def paragraphs(text: str) -> list[list[str]]:
    """Paragraphs (blank-line separated) of sentences; lines starting with '#' are comments."""
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    paras = re.split(r"\n\s*\n", "\n".join(lines))
    out = []
    for p in paras:
        flat = " ".join(p.split())
        if flat:
            out.append([s for s in _SENTENCE.split(flat) if s])
    return out


def spoken_text(script_id: str) -> str:
    return "\n\n".join(" ".join(p) for p in paragraphs(read_script(script_id)))


def wav_path(script_id: str) -> Path:
    return audio_dir() / f"{script_id}.wav"


def render_audio(script_id: str, force: bool = False) -> Path:
    """Synthesise once; later calls reuse the wav unless the script text changed or `force`."""
    import soundfile as sf

    out = wav_path(script_id)
    txt = out.with_suffix(".txt")
    text = spoken_text(script_id)
    if out.is_file() and txt.is_file() and not force and txt.read_text(encoding="utf-8") == text:
        return out
    models = kokoro_dir()
    for name in (MODEL_FILE, VOICES_FILE):
        if not (models / name).is_file():
            raise SystemExit(f"th audio: {models / name} is missing (run `pnpm lab setup` in the main "
                             "checkout, or point TH_KOKORO_DIR at a folder holding the Kokoro files)")
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(str(models / MODEL_FILE), str(models / VOICES_FILE))
    chunks: list[np.ndarray] = []
    rate = 24000
    for p_i, para in enumerate(paragraphs(read_script(script_id))):
        if p_i:
            chunks.append(np.zeros(int(rate * PARAGRAPH_GAP_S), np.float32))
        for s_i, sentence in enumerate(para):
            if s_i:
                chunks.append(np.zeros(int(rate * SENTENCE_GAP_S), np.float32))
            samples, rate = kokoro.create(sentence, voice=VOICE, speed=SPEED, lang=LANG)
            chunks.append(np.asarray(samples, np.float32))
    audio = np.concatenate(chunks)
    lead = np.zeros(int(rate * 0.3), np.float32)  # a breath of silence before and after
    audio = np.concatenate([lead, audio, lead])
    sf.write(str(out), audio, rate, subtype="PCM_16")
    txt.write_text(text, encoding="utf-8", newline="\n")
    return out
