"""Weights for the live upscalers: $TH_HOME/models/live-upscale/ plus its licence.json.

Rows have the `th fetch` shape ({name, licence, url, revision}); each upscaler adds or replaces its
own rows by name, so realesrgan and maxine share one licence.json. Plain json (no pydantic): this
module also runs inside the FlashHead env.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

from ...paths import models_dir

NAME = "live-upscale"


def upscale_dir() -> Path:
    return models_dir(NAME)


def read_rows() -> list[dict]:
    p = upscale_dir() / "licence.json"
    if not p.is_file():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else [data]


def write_rows(rows: list[dict]) -> Path:
    """Add or replace `rows` (by name) in licence.json."""
    d = upscale_dir()
    d.mkdir(parents=True, exist_ok=True)
    names = {r["name"] for r in rows}
    merged = [r for r in read_rows() if r.get("name") not in names] + rows
    p = d / "licence.json"
    p.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8", newline="\n")
    return p


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url: str, target: Path, sha256: str) -> Path:
    """Download `url` to `target` unless it is already there with the pinned sha256."""
    if target.is_file() and sha256_of(target) == sha256:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "talking-head-fetch"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    got = sha256_of(tmp)
    if got != sha256:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{url}: sha256 {got} does not match the pinned {sha256}")
    tmp.replace(target)
    return target
