"""Weights for the live mattes: $TH_HOME/models/live-matte/ plus its licence.json.

Rows have the `th fetch` shape ({name, licence, url, revision}); each kind adds or replaces its own
rows by name. Plain json and huggingface_hub (no pydantic): this module runs inside the FlashHead env.

Cards read (2026-11-16):
- ZhengPeng7/BiRefNet*: `license: mit` in each card's front matter, MIT LICENSE in the code repo; the
  weights are the author's release under that card. The training sets (DIS5K; the matting variant's
  P3M-10k, AM-2k, AIM-500, ...) carry their own research terms, the same caveat the offline BiRefNet
  matte (th/post/alpha.py) already lives with.
- MediaPipe Selfie Segmentation model card (Google, 2021-05-06): "LICENSED UNDER Apache License,
  Version 2.0"; the .tflite ships inside the Apache-2.0 mediapipe wheel, nothing is downloaded.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ...paths import models_dir

NAME = "live-matte"


@dataclass(frozen=True)
class HfRepo:
    repo: str
    revision: str
    dirname: str

    @property
    def url(self) -> str:
        return f"https://huggingface.co/{self.repo}"


BIREFNET: dict[str, HfRepo] = {
    "birefnet-lite": HfRepo("ZhengPeng7/BiRefNet_lite", "aa62cd87eafb9cc43056d08ef3615a14628b831d",
                            "birefnet-lite"),
    "birefnet-lite-matting": HfRepo("ZhengPeng7/BiRefNet_lite-matting",
                                    "99c33412e3f58e1f33187abdc8c435c645243690", "birefnet-lite-matting"),
    # the offline matte's own pin (th/fetch.py "birefnet"); its existing download is reused
    "birefnet": HfRepo("ZhengPeng7/BiRefNet", "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4", "birefnet"),
}
FILES = ["config.json", "BiRefNet_config.py", "birefnet.py", "model.safetensors", "README.md"]
MEDIAPIPE_ROW = {
    "name": "mediapipe selfie_segmentation.tflite",
    "licence": "Apache-2.0 (Model Card MediaPipe Selfie Segmentation; bundled in the mediapipe wheel)",
    "url": "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf",
    "revision": "mediapipe==0.10.9 wheel, mediapipe/modules/selfie_segmentation/selfie_segmentation.tflite",
}


def matte_dir() -> Path:
    return models_dir(NAME)


def read_rows() -> list[dict]:
    p = matte_dir() / "licence.json"
    if not p.is_file():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else [data]


def write_rows(rows: list[dict]) -> Path:
    """Add or replace `rows` (by name) in licence.json."""
    d = matte_dir()
    d.mkdir(parents=True, exist_ok=True)
    names = {r["name"] for r in rows}
    merged = [r for r in read_rows() if r.get("name") not in names] + rows
    p = d / "licence.json"
    p.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8", newline="\n")
    return p


def record(row: dict) -> None:
    if row not in read_rows():
        write_rows([row])


def birefnet_row(kind: str) -> dict:
    r = BIREFNET[kind]
    return {"name": r.repo, "licence": "MIT", "url": r.url, "revision": r.revision}


def _ready(d: Path) -> bool:
    return all((d / f).is_file() for f in FILES if f != "README.md")


def birefnet_path(kind: str) -> Path:
    """Where `kind`'s files live (the offline download for `birefnet` when it is there)."""
    r = BIREFNET[kind]
    if kind == "birefnet" and _ready(models_dir("birefnet")):
        return models_dir("birefnet")
    return matte_dir() / r.dirname


def fetch_birefnet(kind: str) -> Path:
    """Download `kind` at its pinned revision (once) and record its licence row; returns the dir."""
    d = birefnet_path(kind)
    if not _ready(d):
        from huggingface_hub import snapshot_download

        r = BIREFNET[kind]
        snapshot_download(r.repo, revision=r.revision, local_dir=str(d), allow_patterns=FILES)
    record(birefnet_row(kind))
    return d
