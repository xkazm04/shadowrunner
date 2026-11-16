"""`th-timeline/1`: what a rig arm hands the timeline capture (apps/web/bench/timeline.ts), one entry
per 30 fps frame. Every key of a frame is always present; `null` means "leave the player's own
behaviour" (its idle blink, gaze, mood, mouth level drive).

- `mouth`: the drawn mouth's shape mix ({shape: weight}, shapes from @sr/avatar MOUTH_SHAPES), or
  null. A mix without `rest` gets rest = 1 - the others' total. Reaches the player through
  `setMouthShapes`.
- `mouthGain`: the speaking mouth's size multiplier (Look.face.mouth.size, 0.3..1.5, on top of the
  rig's own per-shape `mouthGain`), or null.
- `expression`: {family, w}: an expression family (@sr/rig EXPRESSION_FAMILIES) at weight 0..1, or
  null. The page shows it as the family's milder emotion with Look.face.expression.strength = w x
  the profile's strength (`setLook`; the player crossfades the change over MOOD_FADE_S).
- `gesture`: a gesture name, started on the frame it first appears (a run of the same name is one
  gesture), or null.
- `blink`, `gaze`: no public player API takes them. The page counts non-null values and ignores
  them; producers write null.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA = "th-timeline/1"
FPS = 30
MOUTH_SHAPES = ("rest", "openWide", "openMid", "round", "closed", "teeth", "tongue", "narrow")
FAMILIES = ("joy", "showman", "anger", "gloom", "smug", "suspicion")
GESTURES = ("nod", "tilt", "lean_in", "recoil", "glare", "flare")

Shape = Literal["rest", "openWide", "openMid", "round", "closed", "teeth", "tongue", "narrow"]
Family = Literal["joy", "showman", "anger", "gloom", "smug", "suspicion"]
GestureName = Literal["nod", "tilt", "lean_in", "recoil", "glare", "flare"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Expression(_Strict):
    family: Family
    w: float = Field(ge=0, le=1)


class Frame(_Strict):
    t: float = Field(ge=0)
    mouth: dict[Shape, float] | None
    mouthGain: float | None = Field(ge=0.3, le=1.5)
    expression: Expression | None
    gesture: GestureName | None
    blink: float | None = Field(ge=0, le=1)
    gaze: tuple[float, float] | None

    @field_validator("mouth")
    @classmethod
    def _unit_weights(cls, v: dict[str, float] | None) -> dict[str, float] | None:
        if v is not None:
            for shape, w in v.items():
                if not 0 <= w <= 1:
                    raise ValueError(f"mouth.{shape} = {w} is outside 0..1")
        return v

    @field_validator("gaze")
    @classmethod
    def _unit_gaze(cls, v: tuple[float, float] | None) -> tuple[float, float] | None:
        if v is not None and not all(-1 <= c <= 1 for c in v):
            raise ValueError(f"gaze {v} is outside -1..1")
        return v


class Timeline(_Strict):
    schema_: Literal["th-timeline/1"] = Field(alias="schema")
    fps: Literal[30]
    frames: list[Frame] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("frames")
    @classmethod
    def _on_the_clock(cls, frames: list[Frame]) -> list[Frame]:
        for i, f in enumerate(frames):
            if abs(f.t - i / FPS) > 0.5 / FPS:
                raise ValueError(f"frame {i}: t {f.t} is not frame {i} at {FPS} fps")
        return frames

    @property
    def duration_s(self) -> float:
        return len(self.frames) / FPS

    def dump(self) -> dict:
        return self.model_dump(by_alias=True, mode="json")

    def write(self, path: Path) -> Path:
        path.write_text(json.dumps(self.dump(), separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        return path


def empty_frame(i: int) -> Frame:
    """Frame i with every field null: the player's own behaviour."""
    return Frame(t=round(i / FPS, 6), mouth=None, mouthGain=None, expression=None, gesture=None, blink=None, gaze=None)


def load_timeline(path: Path) -> Timeline:
    return Timeline.model_validate(json.loads(path.read_text(encoding="utf-8")))


def json_schema() -> dict:
    """The wire schema (JSON Schema 2020-12, by alias)."""
    return Timeline.model_json_schema(by_alias=True)
