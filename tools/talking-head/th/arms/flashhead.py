"""`realtime-fh` (WP2): SoulX-FlashHead Lite, streaming (on_frame per frame, ttffMs).

Stub until WP2 replaces this module (and only this module)."""

from __future__ import annotations

from .base import StubArm


class FlashHeadArm(StubArm):
    id = "realtime-fh"
    package = "WP2"
