"""`th-run/1`: the run.json contract (spec Data & API). Every key is always present; absent = null."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA = "th-run/1"

# Spec ARM_IDS, in board/report order. The registry (th.arms) maps each to a module.
ARM_IDS: tuple[str, ...] = (
    "noop", "baseline", "diffusion-it", "diffusion-sa", "realtime-fh", "dub-ls", "a2f-keys",
)

Runtime = Literal["native", "docker"]


class _Strict(BaseModel):
    # extra keys are refused so a typo cannot slip into the wire format
    model_config = ConfigDict(extra="forbid")


class Sync(_Strict):
    conf: float | None
    offsetFrames: int | None


class Identity(_Strict):
    mean: float | None
    min: float | None
    p5: float | None


class Weight(_Strict):
    name: str
    licence: str
    url: str
    revision: str | None


class RunRecord(_Strict):
    schema_: Literal["th-run/1"] = Field(alias="schema")
    arm: str
    script: str
    seed: int
    portrait: str
    runtime: Runtime
    width: int
    height: int
    fps: float
    durationS: float
    renderS: float | None
    rtf: float | None
    ttffMs: float | None
    vramPeakMiB: int | None
    gpuExclusive: bool | None
    sync: Sync
    identity: Identity
    faceRoi: tuple[int, int, int, int] | None
    weights: list[Weight]
    notes: str | None

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    def dump(self) -> dict:
        # exclude_none stays False: absent values are written as null, keys always present
        return self.model_dump(by_alias=True, mode="json")

    def write(self, path: Path) -> None:
        path.write_text(json.dumps(self.dump(), indent=2) + "\n", encoding="utf-8", newline="\n")


def load_run(path: Path) -> RunRecord:
    """Validate a run.json; also checks no required key was omitted (pydantic requires them all)."""
    return RunRecord.model_validate(json.loads(path.read_text(encoding="utf-8")))


def json_schema() -> dict:
    return RunRecord.model_json_schema(by_alias=True)
