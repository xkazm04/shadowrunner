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


def _driver_src() -> str:
    return (Path(emv3.__file__).parent / "flash_driver.py").read_text(encoding="utf-8")


def test_driver_only_patches_the_pipeline_move() -> None:
    src = _driver_src()
    compile(src, "th_hands_flash.py", "exec")
    assert "enable_model_cpu_offload" in src and "TH_EMV3_OFFLOAD" in src
    assert "TH_EMV3_TEACACHE" in src and "TH_EMV3_WINDOW" in src and "TH_EMV3_AUDIO_CHUNK" in src
    assert "retinaface" not in src.lower() and "face_detect" not in src


def _driver_plan():
    """The driver's window planner, without importing infer_flash or torch."""
    src = _driver_src()
    start = src.index("def plan(")
    ns: dict = {}
    exec("import math" + chr(10) + src[start:src.index("def _windowed(")], ns)  # noqa: S102
    return ns["plan"]


def test_window_plan_covers_the_line_in_equal_strides() -> None:
    plan = _driver_plan()
    assert plan(121, 121, 9) == [(0, 121)]
    w = plan(449, emv3.WINDOW, emv3.OVERLAP)
    assert w == [(0, 121), (112, 121), (224, 121), (336, 113)]
    for (s0, n0), (s1, _) in zip(w, w[1:]):
        assert s0 + n0 - s1 == emv3.OVERLAP     # each window re-uses the last OVERLAP frames
    assert w[-1][0] + w[-1][1] == 449
    assert all((n - 1) % 4 == 0 and n <= emv3.WINDOW for _, n in w)
    for total in (125, 137, 333, 425, 449, 501):  # th's copy matches the driver's
        assert emv3.window_plan(total) == plan(total, emv3.WINDOW, emv3.OVERLAP)


def test_long_line_frames_are_uncapped_when_windowed() -> None:
    assert emv3.frames_for(18.0, cap=None) == 449
    assert emv3.frames_for(18.0) == emv3.MAX_FRAMES


def test_levers_reach_the_command_line(tmp_path: Path) -> None:
    argv = emv3.command(tmp_path / "ref.png", tmp_path / "a.wav", tmp_path / "w", 7, 12, 125, 4.5,
                        6.0, negative=emv3.NEGATIVES["fingers"], shift=3.0)
    assert argv[argv.index("--negative_prompt") + 1].startswith("Deformed hands")
    assert argv[argv.index("--shift") + 1] == "3.0"
    assert argv[argv.index("--audio_guidance_scale") + 1] == "4.5"
    env = emv3.driver_env(offload=True, teacache=False, window=121, audio_chunk=113)
    assert env == {"TH_EMV3_OFFLOAD": "1", "TH_EMV3_TEACACHE": "0", "TH_EMV3_WINDOW": "121",
                   "TH_EMV3_OVERLAP": str(emv3.OVERLAP), "TH_EMV3_AUDIO_CHUNK": "113"}


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


def test_chunked_audio_features_keep_each_frame_once(monkeypatch) -> None:
    """The driver's per-chunk wav2vec wrapper, with a stub encoder that tags each frame by its
    absolute index: every frame comes back once, in order, from its own chunk."""
    import numpy as np
    import torch

    src = _driver_src()
    start = src.index("AUDIO_MARGIN = ")
    calls: list[tuple[int, int]] = []

    def stub(mel, _fe, _enc, n, sr=16000, fps=25, device="cpu"):
        first = int(mel[0])                 # the stub audio holds its frame index per sample
        calls.append((first, n))
        return torch.arange(first, first + n, dtype=torch.float32).view(n, 1, 1)

    ns: dict = {"os": __import__("os"), "torch": torch, "_embed": stub}
    exec(src[start:src.index("def _remove_tolerant(")], ns)  # noqa: S102
    monkeypatch.setenv("TH_EMV3_AUDIO_CHUNK", "113")
    mel = np.repeat(np.arange(425, dtype=np.float32), 640)
    out = ns["_chunked_embed"](mel, None, None, 425)
    assert out.view(-1).tolist() == list(range(425))
    assert calls[0] == (0, 113 + 25) and calls[1] == (113 - 25, 113 + 50)
