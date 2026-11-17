"""iris-hands candidates without a GPU: the EchoMimicV3-Flash length rule, its command line (the Flash
path only, never the RetinaFace one) and the offload driver; the StableAvatar command."""

from __future__ import annotations

from pathlib import Path

import pytest

from th.experiments.hands import emv3, stableavatar


def test_frames_follow_the_vae_stride_and_the_cap() -> None:
    assert emv3.frames_for(5.132) == 125      # 128 frames -> 4k + 1
    assert emv3.frames_for(7.0) == 137        # capped at MAX_FRAMES, already 4k + 1
    assert (emv3.frames_for(3.3) - 1) % 4 == 0


def test_emv3_command_is_the_flash_path(tmp_path: Path) -> None:
    argv = emv3.command(tmp_path / "ref.png", tmp_path / "a.wav", tmp_path / "w", 7, 8, 125, 3.0, 6.0)
    assert argv[:2] == ["python", "th_hands_flash.py"]
    joined = " ".join(argv)
    assert "infer_preview" not in joined and "app" not in argv[1]
    assert argv[argv.index("--video_length") + 1] == "125"
    assert argv[argv.index("--num_inference_steps") + 1] == "8"
    assert "--negative_prompt" not in argv  # keep upstream's hand-quality negative prompt
    assert "chinese-wav2vec2-base" in argv[argv.index("--wav2vec_model_dir") + 1]


def test_driver_only_patches_the_pipeline_move() -> None:
    src = emv3.DRIVER
    compile(src, "th_hands_flash.py", "exec")
    assert "enable_model_cpu_offload" in src and "TH_EMV3_OFFLOAD" in src
    assert "retinaface" not in src.lower() and "face_detect" not in src


def test_emv3_skips_the_face_detector_dependencies() -> None:
    names = " ".join(emv3.DEPS).lower()
    assert "retina" not in names and "tensorflow" not in names and "insightface" not in names


def test_stableavatar_command_uses_the_vertical_checkpoint(tmp_path: Path) -> None:
    argv = stableavatar.command(tmp_path / "r.png", tmp_path / "a.wav", tmp_path, 1, 50,
                                "model_cpu_offload", "rec-vec")
    assert "--width=480" in argv and "--height=832" in argv
    assert any(a.endswith("transformer3d-rec-vec.pt") for a in argv)


def test_cost_per_video_minute() -> None:
    from th.experiments.hands import cost

    # 600 s of render for 6 s of video = 100x real time -> 100 GPU-minutes per video-minute
    assert cost.gpu_hours_per_video_minute(600, 6) == pytest.approx(100 / 60)
    assert cost.cloud_per_video_minute(600, 6, 3.0, 2.0) == pytest.approx(100 / 60 / 2 * 3.0)
    assert cost.local_kwh_per_video_minute(600, 6, 450) == pytest.approx(100 / 60 * 0.6)
    t = cost.table(600, 6, 450)
    assert t["h100-80gb runpod-secure $"] < t["a100-80gb runpod-secure $"] * 2
