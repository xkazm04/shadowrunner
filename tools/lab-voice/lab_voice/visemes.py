"""Phonemes to Oculus-15 viseme spans (the set of apps/lab/src/contract.ts).

Kokoro's g2p (espeak-ng through kokoro-onnx) yields IPA. Each phoneme maps to one viseme; stress and
length marks carry no mouth shape of their own, so their time extends the viseme before them. Runs
of the same viseme merge into one span. Two sources of timing:

- ``durations``: per-phoneme start/end seconds from the model's duration output.
- ``uniform``: no durations, so the phonemes share the audio evenly (the caller says so).

Pure Python, no model and no numpy, so the unit tests run without the venv's heavy packages.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

VISEMES: tuple[str, ...] = (
    "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou",
)

_GROUPS: dict[str, str] = {
    "PP": "pbm",
    "FF": "fv",
    "TH": "θð",
    "DD": "tdɾT",
    "kk": "kgɡŋhxʔq",
    "CH": "ʃʒʧʤç",
    "SS": "sz",
    "nn": "nlɫɲ",
    "RR": "ɹrɻɚɝ˞",
    "aa": "aɑæʌɐIW",
    "E": "eɛəɜᵊA",
    "ih": "iɪjyᵻ",
    "oh": "oɔɒOY",
    "ou": "uʊwɯ",
}

#: IPA symbol -> viseme. Built from the groups above so each symbol appears once.
PHONEME_VISEME: dict[str, str] = {ch: v for v, chars in _GROUPS.items() for ch in chars}

#: Marks that modify the phoneme before them: no shape, their time joins the previous span.
MODIFIERS = frozenset("ˈˌːˑ̩̯̃")

#: Word gaps and punctuation: the mouth rests.
SILENT = frozenset(" .,!?;:-—…\"'()\n\t")


def viseme_of(phoneme: str) -> str | None:
    """The viseme of one IPA symbol; None for a modifier (it extends the previous span)."""
    if phoneme in MODIFIERS:
        return None
    if phoneme in SILENT:
        return "sil"
    return PHONEME_VISEME.get(phoneme, "sil")


@dataclass(frozen=True)
class Span:
    v: str
    start_ms: int
    end_ms: int

    def to_json(self) -> dict[str, object]:
        return {"v": self.v, "startMs": self.start_ms, "endMs": self.end_ms}


def spans(timed: Iterable[tuple[str, float, float]]) -> list[Span]:
    """Merged viseme spans from (phoneme, start_s, end_s) triples, in audio order."""
    out: list[Span] = []
    for phoneme, start, end in timed:
        start_ms, end_ms = round(start * 1000), round(end * 1000)
        if end_ms <= start_ms:
            continue
        v = viseme_of(phoneme)
        if v is None:
            if out:
                out[-1] = Span(out[-1].v, out[-1].start_ms, max(out[-1].end_ms, end_ms))
            continue
        if out and out[-1].v == v and out[-1].end_ms >= start_ms:
            out[-1] = Span(v, out[-1].start_ms, max(out[-1].end_ms, end_ms))
        else:
            out.append(Span(v, start_ms, end_ms))
    return out


def uniform(phonemes: Sequence[str], duration_s: float) -> list[Span]:
    """Spans when the model gives no durations: every phoneme gets an equal share of the audio."""
    if not phonemes or duration_s <= 0:
        return []
    step = duration_s / len(phonemes)
    return spans((p, i * step, (i + 1) * step) for i, p in enumerate(phonemes))
