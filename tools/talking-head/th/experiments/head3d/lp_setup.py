"""LivePortrait (KwaiVGI, MIT code and weights) for the head3d experiment: code and weights, nothing else.

- Code: github.com/KwaiVGI/LivePortrait at a pinned commit, cloned into $TH_HOME/repos/liveportrait.
  Only `src/` (the wrapper, the modules, the crop and camera helpers) is imported.
- Weights: the five PyTorch checkpoints from huggingface.co/KwaiVGI/LivePortrait (model card
  `license: mit`), sha256-pinned, into $TH_HOME/models/liveportrait/ with a licence.json.
- NOT fetched: `insightface/models/buffalo_l` (InsightFace, non-commercial; upstream's face detector
  and 106-point landmarks), `liveportrait/landmark.onnx` (upstream's 203-point landmark refiner,
  only used behind the InsightFace detector) and the animal X-Pose weights. Face detection and
  landmarks come from MediaPipe Face Landmarker (Apache-2.0, `th fetch mediapipe`).
- No environment of its own: the modules need torch, numpy, opencv, pyyaml and scipy, which the
  FlashHead env (`$TH_HOME/envs/realtime-fh`) already has, so the bridge runs there with the repo on
  sys.path and nothing installed. That is also where a live wiring would have to run it.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from ...arms.base import read_licences, write_licences
from ...fetch import _download
from ...paths import models_dir, th_home
from ...schema import Weight

REPO = "https://github.com/KwaiVGI/LivePortrait.git"
COMMIT = "9b294b3d0536135442ea73cb01e6cb3ca7029dd3"
HF = "KwaiVGI/LivePortrait"
HF_REV = "82a4fa6735ca58432b6ce39301b4b9ee066dea47"
LICENCE = "MIT (github.com/KwaiVGI/LivePortrait LICENSE; HF model card license: mit)"
WEIGHTS = {
    "base_models/appearance_feature_extractor.pth": "5279bb8654293dbdf327030b397f107237dd9212fb11dd75b83dfb635211ceb5",
    "base_models/motion_extractor.pth": "251e6a94ad667a1d0c69526d292677165110ef7f0cf0f6d199f0e414e8aa0ca5",
    "base_models/spade_generator.pth": "4780afc7909a9f84e24c01d73b31a555ef651521a1fe3b2429bd04534d992aee",
    "base_models/warping_module.pth": "2f61a6f265fe344f14132364859a78bdbbc2068577170693da57fb96d636e282",
    "retargeting_models/stitching_retargeting_module.pth": "3652d5a3f95099141a56986aaddec92fadf0a73c87a20fac9a2c07c32b28b611",
}


def repo_dir() -> Path:
    return th_home() / "repos" / "liveportrait"


def weights_dir() -> Path:
    return models_dir("liveportrait")


def ensure() -> tuple[Path, Path]:
    """Clone the code and fetch the weights when missing; returns (repo, weights)."""
    repo = repo_dir()
    if not (repo / "src" / "live_portrait_wrapper.py").is_file():
        repo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", REPO, str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "checkout", COMMIT], check=True)
    d = weights_dir()
    rows = read_licences(d)
    if len(rows) < len(WEIGHTS):
        rows = []
        for rel, sha in WEIGHTS.items():
            target = d / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.is_file():
                url = f"https://huggingface.co/{HF}/resolve/{HF_REV}/liveportrait/{rel}"
                print(f"head3d: fetching {rel}", file=sys.stderr)
                _download(url, target, sha)
            rows.append(Weight(name=f"{HF}/liveportrait/{rel}", licence=LICENCE,
                               url=f"https://huggingface.co/{HF}", revision=f"sha256:{sha}"))
        write_licences(d, rows)
    return repo, d


if __name__ == "__main__":
    print(ensure())
