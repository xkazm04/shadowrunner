"""diffusion-sa (StableAvatar): command construction and setup checks; no GPU, no weights."""

from __future__ import annotations

from pathlib import Path

import pytest

from th.arms.base import ArmNotBuilt, Job
from th.arms.stableavatar import PARTS, StableAvatarArm


def job(tmp_path: Path) -> Job:
    return Job(arm="diffusion-sa", script="smoke-6s", script_text="hi", audio=tmp_path / "a.wav",
               audio_s=5.0, portrait=tmp_path / "p.png", seed=7, runtime="native",
               run_dir=tmp_path, log=tmp_path / "log.txt")


@pytest.fixture
def arm(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path / "home"))
    for k in ("TH_SA_SIZE", "TH_SA_MEMORY", "TH_SA_STEPS"):
        monkeypatch.delenv(k, raising=False)
    return StableAvatarArm()


def flags(argv: list[str]) -> dict[str, str]:
    return dict(a[2:].split("=", 1) for a in argv[2:])


def test_command_mirrors_inference_sh_with_our_paths(arm, tmp_path):
    argv = arm.command(job(tmp_path), tmp_path / "work", arm.settings())
    assert argv[:2] == ["python", "inference.py"]
    f = flags(argv)
    m = arm.env.models
    assert f["config_path"] == "deepspeed_config/wan2.1/wan_civitai.yaml"
    assert f["pretrained_model_name_or_path"] == str(m / "Wan2.1-Fun-V1.1-1.3B-InP")
    assert f["transformer_path"].endswith("transformer3d-square.pt")
    assert f["pretrained_wav2vec_path"] == str(m / "wav2vec2-base-960h")
    assert f["validation_reference_path"] == str((tmp_path / "p.png").resolve())
    assert f["validation_driven_audio_path"] == str((tmp_path / "a.wav").resolve())
    assert f["output_dir"] == str(tmp_path / "work")
    assert (f["width"], f["height"], f["seed"]) == ("512", "512", "7")
    assert f["GPU_memory_mode"] == "model_cpu_offload" and f["sample_steps"] == "50"


def test_knobs_and_their_validation(arm, tmp_path, monkeypatch):
    monkeypatch.setenv("TH_SA_SIZE", "480x832")
    monkeypatch.setenv("TH_SA_MEMORY", "model_full_load")
    monkeypatch.setenv("TH_SA_STEPS", "30")
    f = flags(arm.command(job(tmp_path), tmp_path, arm.settings()))
    assert (f["width"], f["height"]) == ("480", "832")
    assert f["GPU_memory_mode"] == "model_full_load" and f["sample_steps"] == "30"
    monkeypatch.setenv("TH_SA_MEMORY", "lots")
    with pytest.raises(ArmNotBuilt, match="TH_SA_MEMORY"):
        arm.settings()


def test_preflight_fails_fast_when_not_fetched(arm):
    with pytest.raises(ArmNotBuilt, match="th fetch diffusion-sa"):
        arm.preflight("native")


def test_weights_pinned_permissive_no_vocal_separator():
    assert {p.licence for p in PARTS} <= {"Apache-2.0", "MIT"}
    assert all(len(p.revision) == 40 for p in PARTS)
    sa = next(p for p in PARTS if p.repo == "FrancisRing/StableAvatar")
    assert sa.allow and not any("Kim_Vocal" in a or "Wan2.1" in a for a in sa.allow)
