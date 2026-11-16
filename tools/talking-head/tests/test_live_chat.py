"""th.live.chat against a fake streaming client: sentence splitting, markdown stripping, cancellation
closes the stream, history capping, the missing-key and API-error apologies. No network."""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import pytest

from th.live import chat

SECRET = "sk-ant-test-SECRET-0123456789"


class FakeStream:
    def __init__(self, chunks, *, hang=False, error=None, stop="end_turn"):
        self.chunks, self.hang, self.error, self.stop = list(chunks), hang, error, stop
        self.closed = False
        self.released = asyncio.Event()

    async def _text(self):
        for c in self.chunks:
            await asyncio.sleep(0)
            yield c
        if self.error is not None:
            raise self.error
        if self.hang:
            await self.released.wait()  # a slow model: never released in these tests

    @property
    def text_stream(self):
        return self._text()

    async def close(self):
        self.closed = True

    async def get_final_message(self):
        return SimpleNamespace(stop_reason=self.stop, stop_details=None)


class FakeManager:
    """Mirrors the SDK's AsyncMessageStreamManager: leaving the block closes the stream."""

    def __init__(self, stream):
        self.stream = stream

    async def __aenter__(self):
        return self.stream

    async def __aexit__(self, *exc):
        await self.stream.close()


class FakeClient:
    def __init__(self, stream):
        self._stream = stream
        self.calls: list[dict] = []
        self.messages = self

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        return FakeManager(self._stream)


@pytest.fixture
def fake(monkeypatch):
    def install(stream: FakeStream) -> FakeClient:
        client = FakeClient(stream)
        monkeypatch.setattr(chat, "get_client", lambda: client)
        return client

    return install


def collect(text: str, history: list[dict]) -> list[str]:
    async def run():
        return [s async for s in chat.reply_sentences(text, history)]

    return asyncio.run(run())


# ---------------------------------------------------------------- splitting

TRICKY = (
    "Hi, I'm Iris. Version 3.5 shipped today! Dr. Lee and Mr. Kim loved it, e.g. the speed... "
    "honestly. Wait... What? Done"
)
TRICKY_SENTENCES = [
    "Hi, I'm Iris.",
    "Version 3.5 shipped today!",
    "Dr. Lee and Mr. Kim loved it, e.g. the speed... honestly.",
    "Wait...",
    "What?",
    "Done",
]


@pytest.mark.parametrize("size", [1, 2, 3, 7, len(TRICKY)])
def test_splitter_handles_abbreviations_numbers_and_ellipses(size):
    sp = chat.SentenceSplitter()
    out = []
    for i in range(0, len(TRICKY), size):
        out += sp.feed(TRICKY[i : i + size])
    out += sp.flush()
    assert out == TRICKY_SENTENCES


def test_sentence_leaves_as_soon_as_the_next_character_confirms_it():
    sp = chat.SentenceSplitter()
    assert sp.feed("Hello there.") == []  # "3." or "Dr." could still continue
    assert sp.feed(" ") == []
    assert sp.feed("N") == ["Hello there."]
    assert sp.feed("ice to meet you") == []
    assert sp.flush() == ["Nice to meet you"]


def test_newlines_and_list_markers_split_cleanly():
    sp = chat.SentenceSplitter()
    out = sp.feed("Two things:\n1. First item\n2. Second item\n") + sp.flush()
    assert out == ["Two things:", "1. First item", "2. Second item"]


def test_run_on_text_is_cut_at_a_comma():
    sp = chat.SentenceSplitter()
    long = ", ".join(["and then another clause follows"] * 12)
    out = sp.feed(long)
    assert len(out) == 1 and out[0].endswith(",") and len(out[0]) <= chat.MAX_SENTENCE_CHARS


# ---------------------------------------------------------------- speakable

@pytest.mark.parametrize(
    ("raw", "spoken"),
    [
        ("**Bold** move, see [the docs](https://example.com) \U0001F389 :)", "Bold move, see the docs"),
        ("## A heading", "A heading"),
        ("- a bullet point.", "a bullet point."),
        ("3. Third item.", "Third item."),
        ("Use `pnpm test` *now*!", "Use pnpm test now!"),
        ("Visit https://example.com/x today.", "Visit today."),
        ("[laughs] That is funny \U0001F602\U0001F525", "That is funny"),
        ("\U0001F44B\U0001F3FD", ""),
        ("snake_case stays, _emphasis_ goes.", "snake_case stays, emphasis goes."),
        ("> quoted | piped #tag", "quoted piped tag"),
    ],
)
def test_speakable_strips_markdown_and_emoji(raw, spoken):
    assert chat.speakable(raw) == spoken


def test_reply_streams_speakable_sentences(fake):
    reply = "Sure! Here are **two**:\n\n1. Fast *start*.\n2. Calm voice \U0001F60A\n"
    chunks = [reply[i : i + 4] for i in range(0, len(reply), 4)]
    fake(FakeStream(chunks))
    history: list[dict] = []
    assert collect("Tell me two things.", history) == ["Sure!", "Here are two:", "Fast start.", "Calm voice"]
    assert history == [
        {"role": "user", "content": "Tell me two things."},
        {"role": "assistant", "content": "Sure! Here are two: Fast start. Calm voice"},
    ]


# ---------------------------------------------------------------- cancellation

def test_task_cancel_closes_the_stream(fake):
    stream = FakeStream(["First sentence. ", "Second"], hang=True)
    fake(stream)
    history: list[dict] = []

    async def run():
        got: list[str] = []
        first = asyncio.Event()

        async def consume():
            async for s in chat.reply_sentences("hi", history):
                got.append(s)
                first.set()

        task = asyncio.create_task(consume())
        await asyncio.wait_for(first.wait(), 2)
        assert not stream.closed
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return got

    assert asyncio.run(run()) == ["First sentence."]
    assert stream.closed
    # What was spoken before the cut is remembered; the unfinished "Second" is not.
    assert history[-1] == {"role": "assistant", "content": "First sentence."}


def test_aclose_closes_the_stream(fake):
    stream = FakeStream(["One. ", "Two. ", "Three. ", "Four."], hang=True)
    fake(stream)

    async def run():
        gen = chat.reply_sentences("count", [])
        first = await gen.__anext__()
        await gen.aclose()
        return first

    assert asyncio.run(run()) == "One."
    assert stream.closed


# ---------------------------------------------------------------- history

def test_history_is_capped_and_starts_on_a_user_turn(fake):
    client = fake(FakeStream(["Noted. ", "Bye."]))
    history: list[dict] = []
    for n in range(15):
        history += [{"role": "user", "content": f"q{n}"}, {"role": "assistant", "content": f"a{n}"}]
    history.insert(0, {"role": "assistant", "content": "stray"})

    assert collect("latest", history) == ["Noted.", "Bye."]
    sent = client.calls[0]["messages"]
    assert len(sent) == chat.MAX_HISTORY_MESSAGES + 1
    assert sent[0]["role"] == "user" and sent[-1] == {"role": "user", "content": "latest"}
    assert len(history) == chat.MAX_HISTORY_MESSAGES
    assert history[0]["role"] == "user"
    assert history[-2:] == [
        {"role": "user", "content": "latest"},
        {"role": "assistant", "content": "Noted. Bye."},
    ]


def test_capped_drops_a_leading_assistant_message():
    msgs = [{"role": "assistant", "content": "x"}, {"role": "user", "content": "y"}]
    assert chat.capped(msgs) == [{"role": "user", "content": "y"}]


# ---------------------------------------------------------------- errors and key

def test_missing_key_yields_one_apology(monkeypatch, caplog):
    for name in chat.KEY_ENVS:
        monkeypatch.delenv(name, raising=False)
    history: list[dict] = []
    with caplog.at_level(logging.WARNING, logger="th.live.chat"):
        assert collect("hello", history) == [chat.NO_KEY_APOLOGY]
    assert history == []
    assert "no API key" in caplog.text


def test_api_error_yields_apology_and_logs_without_the_key(fake, monkeypatch, caplog):
    monkeypatch.setenv("ANTHROPIC_KEY_LANE_HACKATHON", SECRET)
    err = RuntimeError(f"upstream said: bad key {SECRET}")
    err.status_code = 401
    fake(FakeStream([], error=err))
    history: list[dict] = []
    with caplog.at_level(logging.ERROR, logger="th.live.chat"):
        assert collect("hello", history) == [chat.API_APOLOGY]
    assert history == []
    assert "RuntimeError 401" in caplog.text and SECRET not in caplog.text


def test_error_mid_reply_keeps_what_was_said(fake):
    fake(FakeStream(["Half a thought. ", "And"], error=ConnectionError("reset")))
    history: list[dict] = []
    assert collect("go on", history) == ["Half a thought.", chat.API_APOLOGY]
    assert history[-1] == {"role": "assistant", "content": "Half a thought."}


def test_refusal_with_nothing_said_yields_a_line(fake):
    fake(FakeStream([], stop="refusal"))
    assert collect("something", []) == [chat.REFUSAL_LINE]


def test_request_params_model_and_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_KEY_LANE_HACKATHON", SECRET)
    monkeypatch.delenv(chat.MODEL_ENV, raising=False)
    p = chat.request_params([{"role": "user", "content": "hi"}])
    assert p["model"] == "claude-haiku-5-5"
    assert p["thinking"] == {"type": "disabled"} and p["max_tokens"] == chat.HAIKU_MAX_TOKENS
    assert p["system"][0]["text"] == chat.persona()
    assert SECRET not in repr(p)

    monkeypatch.setenv(chat.MODEL_ENV, "claude-opus-5-5")
    p = chat.request_params([{"role": "user", "content": "hi"}])
    assert p["model"] == "claude-opus-5-5" and "thinking" not in p
    assert p["max_tokens"] == chat.OTHER_MAX_TOKENS


def test_persona_says_ai_character_and_spoken_rules():
    text = chat.persona()
    assert text.startswith("You are Iris")
    for needle in ("AI character", "not a real person", "No markdown", "No emoji", "stage directions"):
        assert needle in text


def test_blank_input_yields_nothing(fake):
    client = fake(FakeStream(["Hi."]))
    assert collect("   ", []) == []
    assert client.calls == []
