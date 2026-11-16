"""diffusion-it (InfiniteTalk): command construction and setup checks; no GPU, no weights."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from th.arms.base import ArmNotBuilt, Job
from th.arms.infinitetalk import PARTS, HfPart, InfiniteTalkArm, require_parts
from th.arms.base import ArmEnv

PERMISSIVE = ("Apache-2.0", "MIT")


def job(tmp_path: Path, audio_s: float = 44.89) -> Job:
    return Job(arm="diffusion-it", script="pitch-45s", script_text="hi", audio=tmp_path / "a.wav",
               audio_s=audio_s, portrait=tmp_path / "p.png", seed=1116, runtime="native",
               run_dir=tmp_path, log=tmp_path / "log.txt")


@pytest.fixture
def arm(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path / "home"))
    for k in ("TH_IT_SIZE", "TH_IT_STEPS", "TH_IT_TEACACHE", "TH_IT_PERSISTENT", "TH_IT_MARLIN"):
        monkeypatch.delenv(k, raising=False)
    return InfiniteTalkArm()


def arg(argv: list[str], flag: str) -> str:
    return argv[argv.index(flag) + 1]


def test_command_runs_the_fp8_offloaded_streaming_path(arm, tmp_path):
    argv = arm.command(job(tmp_path), tmp_path / "work", arm.settings())
    assert argv[0] == "python" and argv[1] == "-c" and argv[3] == "generate_infinitetalk.py"
    assert "WeightQBytesTensor(" in argv[2] and "run_path" in argv[2]
    compile(argv[2], "launch", "exec")
    m = arm.env.models
    assert arg(argv, "--ckpt_dir") == str(m / "Wan2.1-I2V-14B-480P")
    assert arg(argv, "--quant") == "fp8"
    assert arg(argv, "--quant_dir").endswith("infinitetalk_single_fp8.safetensors")
    assert arg(argv, "--num_persistent_param_in_dit") == "0"
    assert arg(argv, "--mode") == "streaming"
    assert arg(argv, "--size") == "infinitetalk-480"
    assert arg(argv, "--sample_steps") == "40"
    assert arg(argv, "--base_seed") == "1116"
    assert arg(argv, "--save_file") == str(tmp_path / "work" / "out")
    # the upstream default caps at 1000 frames (40 s); pitch-45s needs more
    assert int(arg(argv, "--max_frame_num")) >= 44.89 * 25
    assert "--use_teacache" not in argv and "--infinitetalk_dir" not in argv


def test_knobs_720p_steps_teacache_and_bad_size(arm, tmp_path, monkeypatch):
    monkeypatch.setenv("TH_IT_SIZE", "infinitetalk-720")
    monkeypatch.setenv("TH_IT_STEPS", "20")
    monkeypatch.setenv("TH_IT_TEACACHE", "1")
    monkeypatch.setenv("TH_IT_MARLIN", "1")
    argv = arm.command(job(tmp_path), tmp_path, arm.settings())
    assert argv[:2] == ["python", "generate_infinitetalk.py"]  # the stock path, no launcher
    assert arg(argv, "--size") == "infinitetalk-720" and arg(argv, "--sample_steps") == "20"
    assert "--use_teacache" in argv
    monkeypatch.setenv("TH_IT_SIZE", "infinitetalk-1080")
    with pytest.raises(ArmNotBuilt, match="TH_IT_SIZE"):
        arm.settings()


def test_input_json_points_at_portrait_and_audio(arm, tmp_path):
    p = arm.input_json(job(tmp_path), tmp_path)
    body = json.loads(p.read_text(encoding="utf-8"))
    assert body["cond_video"] == (tmp_path / "p.png").resolve().as_posix()
    assert body["cond_audio"] == {"person1": (tmp_path / "a.wav").resolve().as_posix()}
    assert "silver" in body["prompt"]


def test_preflight_names_the_fetch_command(arm):
    with pytest.raises(ArmNotBuilt, match=r"run `uv run th fetch diffusion-it`"):
        arm.preflight("native")
    with pytest.raises(ArmNotBuilt, match="docker runtime not implemented"):
        arm.preflight("docker")


def test_require_parts_passes_once_everything_is_there(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    env = ArmEnv("x")
    part = HfPart("w", "org/w", "abc", "MIT", None, ("a.bin",))
    with pytest.raises(ArmNotBuilt):
        require_parts("x", env, (part,))
    (env.repo / ".git").mkdir(parents=True)
    env.python.parent.mkdir(parents=True)
    env.python.write_bytes(b"")
    (env.models / "w").mkdir(parents=True)
    (env.models / "w" / "a.bin").write_bytes(b"")
    require_parts("x", env, (part,))


def test_weights_are_pinned_permissive_and_skip_unused_shards():
    for p in PARTS:
        assert len(p.revision) == 40 and p.licence in PERMISSIVE
        row = p.weight()
        assert row.url == f"https://huggingface.co/{p.repo}" and row.revision == p.revision
    wan = next(p for p in PARTS if p.repo == "Wan-AI/Wan2.1-I2V-14B-480P")
    assert wan.allow and not any("diffusion_pytorch_model" in a or "t5" in a for a in wan.allow)
    it = next(p for p in PARTS if p.repo == "MeiGen-AI/InfiniteTalk")
    assert it.allow and all("multi" not in a and "int8" not in a for a in it.allow)
