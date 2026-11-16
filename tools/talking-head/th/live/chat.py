"""Conversation for live Iris (flashhead-live task 4): one streamed Anthropic Messages call per chat
turn, cut into speakable sentences as the text arrives.

Contract (design "Interfaces"): `reply_sentences(text, history)` yields each sentence as soon as its
terminator is confirmed, with markdown and emoji stripped so the TTS never reads a symbol. The
caller owns `history` (a list of `{role, content}`) and cancellation: closing the generator
(`aclose()`) or cancelling the task that iterates it closes the HTTP stream at once.

The key is read here, in the server process, from `ANTHROPIC_KEY_LANE_HACKATHON` (else
`ANTHROPIC_API_KEY`). It goes only into the SDK client; it is never logged, yielded or returned.
`anthropic` is imported lazily, so the module (and its tests) load without the SDK installed.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncIterator

log = logging.getLogger("th.live.chat")

KEY_ENVS = ("ANTHROPIC_KEY_LANE_HACKATHON", "ANTHROPIC_API_KEY")
MODEL_ENV = "TH_LIVE_MODEL"
DEFAULT_MODEL = "claude-haiku-5-5"
# Spoken replies are one to three sentences. Haiku runs with thinking off (as packages/engine
# does), so 300 tokens are all answer; other models think adaptively and need room for it.
HAIKU_MAX_TOKENS = 300
OTHER_MAX_TOKENS = 1024
CLIENT_TIMEOUT_S = 20.0
CLIENT_MAX_RETRIES = 1
# History: the last 12 exchanges (24 messages) reach the model and stay in the caller's list.
MAX_HISTORY_TURNS = 12
MAX_HISTORY_MESSAGES = 2 * MAX_HISTORY_TURNS
MAX_USER_CHARS = 1000
# A sentence with no terminator is cut at a comma (or a space) past this many characters, so a
# run-on reply still reaches the TTS early.
MAX_SENTENCE_CHARS = 220

NO_KEY_APOLOGY = "Sorry, I can't chat right now, my conversation link isn't set up."
API_APOLOGY = "Sorry, I lost my train of thought there, could you say that again?"
REFUSAL_LINE = "I'd rather not go there, ask me something else."

PERSONA_FILE = Path(__file__).with_name("persona.md")


@functools.lru_cache(maxsize=1)
def persona() -> str:
    """Iris's system prompt (`persona.md`, next to this module)."""
    return PERSONA_FILE.read_text(encoding="utf-8").strip()


def model_id() -> str:
    return os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def api_key() -> str | None:
    for name in KEY_ENVS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


# ---------------------------------------------------------------- sentences

_TERMINATORS = ".!?…"
# Characters that may close a sentence after its terminator: quotes, brackets, markdown emphasis.
_CLOSERS = "\"'”’)]*_"
_ABBREVIATIONS = frozenset({
    "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "mt.", "jr.", "sr.", "vs.", "no.", "fig.",
    "approx.", "e.g.", "i.e.", "cf.", "ca.",
})
_LIST_MARKER = re.compile(r"^\s*\d+\.$")
_SOFT_BREAK = re.compile(r"[,;:]\s|\s[-–—]\s")


def _is_abbreviation(sentence: str) -> bool:
    words = sentence.split()
    if not words:
        return False
    last = words[-1].lstrip("\"'(“‘*_").lower()
    if last in _ABBREVIATIONS:
        return True
    # A single initial ("J. R. Tolkien"), but not a one-letter sentence like "I."
    return len(last) == 2 and last[0].isalpha() and last[0] != "i" and last[1] == "."


class SentenceSplitter:
    """Cuts streamed text into sentences. A terminator (`. ! ? ...`) ends a sentence only once the
    next non-space character has arrived and does not continue it: "3.5", "Dr. Lee", "e.g. this"
    and "well... maybe" stay whole, "Done. Next" splits. A newline always ends a sentence."""

    def __init__(self) -> None:
        self._buf = ""

    def feed(self, text: str) -> list[str]:
        self._buf += text
        out: list[str] = []
        while True:
            cut = self._boundary()
            if cut is None:
                break
            sentence, rest_at = cut
            self._buf = self._buf[rest_at:]
            if sentence.strip():
                out.append(sentence.strip())
        if len(self._buf) > MAX_SENTENCE_CHARS:
            out.append(self._force_cut())
        return out

    def flush(self) -> list[str]:
        rest, self._buf = self._buf.strip(), ""
        return [rest] if rest else []

    def _boundary(self) -> tuple[str, int] | None:
        b = self._buf
        i = 0
        while i < len(b):
            ch = b[i]
            if ch == "\n":
                return b[:i], i + 1
            if ch not in _TERMINATORS:
                i += 1
                continue
            j = i + 1
            while j < len(b) and (b[j] in _TERMINATORS or b[j] in _CLOSERS):
                j += 1
            if j >= len(b):
                return None  # the next character decides; wait for it
            if not b[j].isspace():
                i = j  # "3.5", "U.S.", "wait...what"
                continue
            if b[j] == "\n":
                return b[:j], j + 1
            k = j
            while k < len(b) and b[k] in " \t":
                k += 1
            if k >= len(b):
                return None
            sentence, nxt = b[:j], b[k]
            if nxt == "\n" or not (
                nxt.islower()
                or (ch == "." and _is_abbreviation(sentence))
                or (ch == "." and _LIST_MARKER.match(sentence))
            ):
                return sentence, k
            i = j
        return None

    def _force_cut(self) -> str:
        b = self._buf
        cut = None
        for m in _SOFT_BREAK.finditer(b, 40, MAX_SENTENCE_CHARS):
            cut = m.start() + 1
        if cut is None:
            cut = b.rfind(" ", 0, MAX_SENTENCE_CHARS)
        if cut <= 0:
            cut = MAX_SENTENCE_CHARS
        head, self._buf = b[:cut].strip(), b[cut:].lstrip()
        return head


_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_URL = re.compile(r"https?://\S+|www\.\S+")
_BRACKETED = re.compile(r"\[[^\]]*\]")
_LINE_MARKER = re.compile(r"^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)")
_EMPHASIS = re.compile(r"\*+|`+|~~|(?<!\w)_+|_+(?!\w)")
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿⬀-⯿←-⇿⌀-⏿"
    "︀-️‍⃣\U000E0020-\U000E007F]"
)
_EMOTICON = re.compile(r"(?<!\w)[:;=]-?[)(DPp/\\|](?!\w)")
_SYMBOLS = re.compile(r"[#|<>{}^\\]")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.!?;:…])")


def speakable(sentence: str) -> str:
    """The sentence as a voice should read it: no markdown, links, URLs, bracketed asides, emoji or
    stray symbols. Returns "" when nothing speakable is left."""
    s = _LINK.sub(r"\1", sentence)
    s = _URL.sub("", s)
    s = _BRACKETED.sub("", s)
    s = _LINE_MARKER.sub("", s)
    s = _EMPHASIS.sub("", s)
    s = _EMOJI.sub("", s)
    s = _EMOTICON.sub("", s)
    s = _SYMBOLS.sub(" ", s)
    s = " ".join(s.split())
    s = _SPACE_BEFORE_PUNCT.sub(r"\1", s)
    s = s.lstrip(",;: ")
    return s if any(c.isalnum() for c in s) else ""


# ---------------------------------------------------------------- history

def capped(history: list[dict]) -> list[dict]:
    """The last MAX_HISTORY_MESSAGES messages, starting on a user turn."""
    tail = history[-MAX_HISTORY_MESSAGES:]
    while tail and tail[0].get("role") != "user":
        tail = tail[1:]
    return [{"role": m["role"], "content": m["content"]} for m in tail]


def remember(history: list[dict], user_text: str, reply: str) -> None:
    """Append one exchange to the caller's list and cap it in place."""
    history.append({"role": "user", "content": user_text})
    history.append({"role": "assistant", "content": reply})
    del history[:-MAX_HISTORY_MESSAGES]
    while history and history[0].get("role") != "user":
        del history[0]


# ---------------------------------------------------------------- client

_clients: dict[tuple[str, int], Any] = {}


def get_client() -> Any | None:
    """The SDK client for this event loop, or None without a key. One client (one connection
    pool) per loop, so every turn after the first reuses the TLS connection."""
    key = api_key()
    if key is None:
        return None
    slot = (key, id(asyncio.get_running_loop()))
    client = _clients.get(slot)
    if client is None:
        import anthropic

        client = anthropic.AsyncAnthropic(
            api_key=key, timeout=CLIENT_TIMEOUT_S, max_retries=CLIENT_MAX_RETRIES
        )
        _clients[slot] = client
    return client


def request_params(messages: list[dict], model: str | None = None) -> dict[str, Any]:
    """The `messages.stream` arguments for one turn. Exposed so tests can pin the shape."""
    model = model or model_id()
    params: dict[str, Any] = {
        "model": model,
        "system": [{"type": "text", "text": persona(), "cache_control": {"type": "ephemeral"}}],
        "messages": messages,
        "output_config": {"effort": "low"},
    }
    if model.startswith("claude-haiku"):
        # A short spoken reply needs no reasoning; thinking off is accepted at effort low on Haiku
        # 5.5 and keeps the first sentence fast. Opus 5.5 and Sonnet 5.5 refuse "disabled" (400),
        # so any other model keeps its default adaptive thinking.
        params["thinking"] = {"type": "disabled"}
        params["max_tokens"] = HAIKU_MAX_TOKENS
    else:
        params["max_tokens"] = OTHER_MAX_TOKENS
    return params


def _describe(err: BaseException) -> str:
    """An error for the server log: type, status, request id and message, with the key scrubbed."""
    parts = [type(err).__name__]
    status = getattr(err, "status_code", None)
    if status is not None:
        parts.append(str(status))
    rid = getattr(err, "request_id", None)
    if rid:
        parts.append(f"request {rid}")
    text = f"{' '.join(parts)}: {getattr(err, 'message', None) or err}"
    for name in KEY_ENVS:
        secret = os.environ.get(name, "").strip()
        if secret:
            text = text.replace(secret, "***")
    return text[:500]


# ---------------------------------------------------------------- the turn

async def reply_sentences(text: str, history: list[dict]) -> AsyncIterator[str]:
    """Iris's reply to `text`, one speakable sentence at a time, as the reply streams.

    On completion, `history` gains the user turn and the reply as spoken (the joined sentences),
    capped to the last 12 exchanges. A cancelled reply records what was yielded before the cut; a
    turn that yielded nothing records nothing. A missing key or an API error yields one short
    apology sentence and logs the cause server-side.
    """
    text = " ".join(text.split())[:MAX_USER_CHARS]
    if not text:
        return
    try:
        client = get_client()
    except ImportError as err:  # the SDK is missing from this env
        log.error("chat: cannot load the anthropic SDK (%s); replying with the apology", err)
        yield API_APOLOGY
        return
    if client is None:
        log.warning("chat: no API key (set %s); replying with the apology", KEY_ENVS[0])
        yield NO_KEY_APOLOGY
        return

    params = request_params([*capped(history), {"role": "user", "content": text}])
    splitter = SentenceSplitter()
    spoken: list[str] = []
    try:
        async with client.messages.stream(**params) as stream:
            async for delta in stream.text_stream:
                for raw in splitter.feed(delta):
                    sentence = speakable(raw)
                    if sentence:
                        spoken.append(sentence)
                        yield sentence
            for raw in splitter.flush():
                sentence = speakable(raw)
                if sentence:
                    spoken.append(sentence)
                    yield sentence
            final = await stream.get_final_message()
            stop = getattr(final, "stop_reason", None)
            if stop == "refusal":
                log.info("chat: the model declined (%s)", getattr(final, "stop_details", None))
                if not spoken:
                    yield REFUSAL_LINE
            elif stop == "max_tokens":
                log.warning("chat: reply hit max_tokens=%s", params["max_tokens"])
    except Exception as err:  # SDK and network errors; cancellation is not an Exception
        log.error("chat: %s", _describe(err))
        yield API_APOLOGY
    finally:
        if spoken:
            remember(history, text, " ".join(spoken))
