"""Conversation for live Iris (task 4). Stub until task 4 replaces this module.

Contract (design "Interfaces"): `reply_sentences` yields speakable sentences as the reply streams;
the caller passes the running history (Anthropic message dicts) and owns cancellation.
"""

from __future__ import annotations

from typing import AsyncIterator


def persona() -> str:
    return "You are Iris."


async def reply_sentences(text: str, history: list[dict]) -> AsyncIterator[str]:
    yield "I heard you, but my conversation module is not built yet."
