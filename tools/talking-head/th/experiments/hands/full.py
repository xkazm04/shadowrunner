"""Arm `full` (spec iris-hands round 3, req 9): non-Flash EchoMimicV3, upstream `infer_preview.py`
(antgroup/echomimic_v3, Apache-2.0 code, same clone and venv as the Flash arm) with the main
`BadToBest/EchoMimicV3` transformer (`transformer/`, Apache-2.0 card, 3.41 GB).

What it loads, nothing else:
- the preview DiT (new, $TH_HOME/models/hands-emv3/full-transformer/);
- the Wan2.1-Fun-V1.1-1.3B-InP base (Apache-2.0) from the `diffusion-sa` arm, as the Flash arm;
- facebook/wav2vec2-base-960h (Apache-2.0, 378 MB, new, $TH_HOME/models/hands-emv3/
  wav2vec2-base-960h/): upstream's README names it as the preview's audio encoder (the Flash DiT
  was trained on chinese-wav2vec2-base instead; feeding the preview DiT those features would be a
  mismatch, so the two arms do not share the audio encoder).
- NOT loaded: `src/face_detect.py` (RetinaFace, InsightFace weights: non-commercial). The driver
  puts a stub module in its place before upstream is imported; the face box it returns is measured
  here with MediaPipe Face Landmarker (Apache-2.0, `facebox.py`) and handed over in the config.

`infer_preview.py` has no command line: its `Config` class holds every setting and its main loop
renders `base_dir/{imgs,audios,prompts}/<name>`. `full_driver.py` (copied into the clone as
th_hands_full.py) overrides the Config from a JSON file and patches memory (CPU offload), TeaCache
and the audio features; upstream stays unedited.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from ...arms.base import ArmEnv, read_licences, write_licences
from ...paths import models_dir
from ...schema import Weight
from . import emv3

HF = "BadToBest/EchoMimicV3"
DIT_FILES = {  # rel path -> (lfs sha256 or None, bytes)
    "transformer/diffusion_pytorch_model.safetensors":
        ("ba25a75c7511ba57a346480d50567b57270282c1f3ab121558c07b65a97adf1f", 3414541616),
    "transformer/config.json": (None, 577),
}
W2V = "facebook/wav2vec2-base-960h"
W2V_REV = "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"
W2V_FILES = {
    "model.safetensors": ("8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a", 377607901),
    "config.json": (None, 1596), "feature_extractor_config.json": (None, 158),
    "preprocessor_config.json": (None, 159), "special_tokens_map.json": (None, 85),
    "tokenizer_config.json": (None, 163), "vocab.json": (None, 291),
}
DIT_DIR = "full-transformer"
W2V_DIR = "wav2vec2-base-960h"
LICENCE = "Apache-2.0 (HF model card `license: apache-2.0`, read at the pinned revision)"

# upstream Config's negative prompt, kept verbatim: hands named in English and Chinese ("fast hand
# swinging, frequent finger twitching, exaggerated gestures, repetitive mechanical movements")
UPSTREAM_NEGATIVE = ("Gesture is bad. Gesture is unclear. Strange and twisted hands. Bad hands. Bad "
                     "fingers. Unclear and blurry hands. 手部快速摆动, 手指频繁抽搐, 夸张手势, "
                     "重复机械性动作.")
NEGATIVES = {"upstream": UPSTREAM_NEGATIVE, "fingers": emv3.NEGATIVES["fingers"], "none": ""}
PARTIAL = 113   # upstream partial_video_length: one window (4k + 1)
OVERLAP = 8     # upstream overlap_video_length: frames (chunked path) or latent frames (long CFG)
NAME = "take"   # the one test name in the generated dataset folder


def dit_path() -> Path:
    return models_dir("hands-emv3") / DIT_DIR / "diffusion_pytorch_model.safetensors"


def w2v_path() -> Path:
    return models_dir("hands-emv3") / W2V_DIR


def weight_rows() -> list[Weight]:
    gb = DIT_FILES["transformer/diffusion_pytorch_model.safetensors"][1] / 1e9
    mb = W2V_FILES["model.safetensors"][1] / 1e6
    return [
        Weight(name=f"{HF} (transformer/, the preview DiT, {gb:.2f} GB)", licence=LICENCE,
               url=f"https://huggingface.co/{HF}", revision=emv3.HF_REV),
        Weight(name=f"{W2V} (model.safetensors {mb:.0f} MB + processor files)", licence=LICENCE,
               url=f"https://huggingface.co/{W2V}", revision=W2V_REV),
    ]


def merge_rows(old: list[Weight], new: list[Weight]) -> list[Weight]:
    """`old` with `new` added or replaced by name (the Flash row stays)."""
    names = {w.name for w in new}
    return [w for w in old if w.name not in names] + new


def fetch() -> list[Weight]:
    from ...fetch import _download

    for repo, rev, files, sub, strip in ((HF, emv3.HF_REV, DIT_FILES, DIT_DIR, "transformer/"),
                                         (W2V, W2V_REV, W2V_FILES, W2V_DIR, "")):
        for rel, (sha, size) in files.items():
            target = models_dir("hands-emv3") / sub / rel.removeprefix(strip)
            if target.is_file() and target.stat().st_size == size:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            print(f"hands: fetching {repo}/{rel} ({size / 1e6:.0f} MB)", file=sys.stderr, flush=True)
            _download(f"https://huggingface.co/{repo}/resolve/{rev}/{rel}", target, sha)
    d = models_dir("hands-emv3")
    rows = merge_rows(read_licences(d), weight_rows())
    write_licences(d, rows)
    return rows


def ready() -> bool:
    return dit_path().is_file() and (w2v_path() / "model.safetensors").is_file()


def dataset(root: Path, reference: Path, wav: Path, prompt: str) -> Path:
    """infer_preview's input layout: base_dir/{imgs,audios,prompts}/<NAME>.*"""
    for sub in ("imgs", "audios", "prompts"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(reference, root / "imgs" / f"{NAME}{reference.suffix.lower()}")
    shutil.copyfile(wav, root / "audios" / f"{NAME}.wav")
    (root / "prompts" / f"{NAME}.txt").write_text(prompt, encoding="utf-8")
    return root


def config(base_dir: Path, save_path: Path, face: tuple[int, int, int, int, int, int], *, seed: int,
           steps: int, text_cfg: float, audio_cfg: float, negative: str, neg_scale: float,
           neg_steps: int, long_cfg: bool, partial: int = PARTIAL, overlap: int = OVERLAP,
           dynamic_cfg: bool = True, teacache: bool = False, audio_chunk: int = 0,
           offload: bool = True, shift: float = 5.0, cfg_split: bool = True) -> dict:
    """The driver's JSON: `config` overrides upstream's Config attributes one by one (names as
    upstream spells them); the rest drives the patches. `face` is get_mask_coord's tuple
    (y1, y2, x1, x2, height, width) on the reference image."""
    base = ArmEnv("diffusion-sa").models / "Wan2.1-Fun-V1.1-1.3B-InP"
    cfg = {
        "config_path": "config/config.yaml", "model_name": str(base),
        "transformer_path": str(dit_path()), "wav2vec_model_dir": str(w2v_path()),
        "base_dir": str(base_dir) + "/", "test_name_list": [NAME], "save_path": str(save_path),
        "seed": seed, "num_inference_steps": steps, "guidance_scale": text_cfg,
        "audio_guidance_scale": audio_cfg, "negative_prompt": negative, "neg_scale": neg_scale,
        "neg_steps": neg_steps, "use_longvideo_cfg": long_cfg, "partial_video_length": partial,
        "overlap_video_length": overlap, "use_dynamic_cfg": dynamic_cfg,
        "use_dynamic_acfg": dynamic_cfg, "enable_teacache": teacache, "shift": shift,
    }
    return {"config": cfg, "face": list(face), "offload": offload, "audioChunk": audio_chunk,
            "cfgSplit": cfg_split}


def write_driver() -> Path:
    p = emv3.env().repo / "th_hands_full.py"
    p.write_bytes((Path(__file__).parent / "full_driver.py").read_bytes())
    return p


def write_config(cfg: dict, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def output(save_path: Path) -> Path:
    """upstream saves <save_path>/<time>_gs.._ags../<NAME>_audio.mp4 (and tries `rm -rf` on the
    silent copy, which Windows' shell does not have)."""
    found = sorted(save_path.glob(f"*/{NAME}_audio.mp4"))
    if not found:
        raise SystemExit(f"hands: no {NAME}_audio.mp4 under {save_path}")
    return found[-1]


if __name__ == "__main__":
    print(json.dumps([w.model_dump() for w in fetch()], indent=2))
