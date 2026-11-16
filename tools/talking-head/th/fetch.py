"""`th fetch`: weights into $TH_HOME/models/<name>/ with a licence.json beside them.

Core (post-processing and metrics) models, fetched with `th fetch metrics`:
- birefnet   ZhengPeng7/BiRefNet (MIT), the alpha matte.
- dinov2     facebook/dinov2-small (Apache-2.0), identity embeddings.
- mediapipe  MediaPipe Face Landmarker (Apache-2.0), face and lip boxes.
- syncnet    the original SyncNet v2 evaluation weights (joonson/syncnet_python, MIT), from VGG.
  LatentSync's HF repos carry the same file but are tagged OpenRAIL++-M, so they are not used.
Arm weights come from the arm's own `fetch()` (th/arms/<module>.py).
"""

from __future__ import annotations

import hashlib
import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .arms import ARM_IDS, get_arm
from .arms.base import read_licences, write_licences
from .paths import models_dir
from .schema import Weight


@dataclass(frozen=True)
class HfModel:
    name: str
    repo: str
    licence: str
    revision: str  # pinned commit, so every machine measures with the same weights


@dataclass(frozen=True)
class UrlModel:
    name: str
    url: str
    file: str
    licence: str
    sha256: str | None  # pinned when known; recorded as the revision either way
    # (file, url, sha256) fetched beside the weights, not recorded as weights (test material)
    extras: tuple[tuple[str, str, str], ...] = ()


CORE: dict[str, HfModel | UrlModel] = {
    "birefnet": HfModel("birefnet", "ZhengPeng7/BiRefNet", "MIT", "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"),
    "dinov2": HfModel("dinov2", "facebook/dinov2-small", "Apache-2.0", "ed25f3a31f01632728cabb09d1542f84ab7b0056"),
    "mediapipe": UrlModel(
        "mediapipe",
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "face_landmarker.task", "Apache-2.0",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"),
    "syncnet": UrlModel(
        "syncnet", "https://www.robots.ox.ac.uk/~vgg/software/lipsync/data/syncnet_v2.model",
        "syncnet_v2.model", "MIT (joonson/syncnet_python)",
        "961e8696f888fce4f3f3a6c3d5b3267cf5b343100b238e79b2659bff2c605442",
        # syncnet_python's positive control: a 224x224 25 fps face clip; README result offset 3,
        # confidence 10.021 (tests/test_syncnet.py checks ours against it)
        (("example.avi", "https://www.robots.ox.ac.uk/~vgg/software/lipsync/data/example.avi",
          "1724121b3a50141cfc9e77c034f7de914024d015b92762ae12d3e1a7151b8621"),)),
}
METRIC_MODELS = tuple(CORE)


def model_ready(name: str) -> bool:
    return bool(read_licences(models_dir(name)))


def require(name: str) -> Path:
    d = models_dir(name)
    if not model_ready(name):
        raise SystemExit(f"th: model '{name}' is not fetched; run `uv run th fetch {name}` "
                         f"(or `th fetch metrics` for all post-processing models)")
    return d


def core_weights() -> list[Weight]:
    rows: list[Weight] = []
    for name in METRIC_MODELS:
        rows += read_licences(models_dir(name))
    return rows


def fetch_core(name: str, force: bool = False) -> list[Weight]:
    spec = CORE[name]
    d = models_dir(name)
    if model_ready(name) and not force:
        print(f"th fetch: {name} already in {d}")
        return read_licences(d)
    d.mkdir(parents=True, exist_ok=True)
    if isinstance(spec, HfModel):
        row = _fetch_hf(spec, d)
    else:
        row = _fetch_url(spec, d)
    write_licences(d, [row])
    print(f"th fetch: {name} -> {d} ({row.licence}, {row.revision})")
    return [row]


def _fetch_hf(spec: HfModel, d: Path) -> Weight:
    from huggingface_hub import HfApi, snapshot_download

    sha = HfApi().model_info(spec.repo, revision=spec.revision).sha
    snapshot_download(spec.repo, revision=sha, local_dir=str(d))
    return Weight(name=spec.repo, licence=spec.licence,
                  url=f"https://huggingface.co/{spec.repo}", revision=sha)


def _fetch_url(spec: UrlModel, d: Path) -> Weight:
    digest = _download(spec.url, d / spec.file, spec.sha256)
    for file, url, sha in spec.extras:
        _download(url, d / file, sha)
    return Weight(name=spec.file, licence=spec.licence, url=spec.url, revision=f"sha256:{digest}")


def _download(url: str, target: Path, sha256: str | None) -> str:
    tmp = target.with_suffix(target.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "talking-head-fetch"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    digest = _sha256(tmp)
    if sha256 and digest != sha256:
        tmp.unlink()
        raise SystemExit(f"th fetch: {target.name} sha256 {digest} != pinned {sha256}")
    tmp.replace(target)
    return digest


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(target: str, force: bool = False) -> list[Weight]:
    """`metrics` (all core models), one core model name, or an arm id."""
    if target == "metrics":
        rows: list[Weight] = []
        for name in METRIC_MODELS:
            rows += fetch_core(name, force)
        return rows
    if target in CORE:
        return fetch_core(target, force)
    if target in ARM_IDS:
        rows = get_arm(target).fetch()
        if rows:
            write_licences(models_dir(target), rows)
        print(f"th fetch: {target}: {len(rows)} weight row(s)")
        return rows
    raise SystemExit(f"th fetch: unknown target '{target}' "
                     f"(metrics, {', '.join(CORE)}, or an arm: {', '.join(ARM_IDS)})")
