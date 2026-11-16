"""The rig arms' fast failures (preflight) and the baseline's spoken-text source."""

from pathlib import Path

import pytest

from th.arms import get_arm
from th.arms.base import ArmNotBuilt, Job
from th.arms.baseline import spoken_text


def test_a2f_runs_in_docker_only_with_a_hint():
    with pytest.raises(ArmNotBuilt, match="runs in docker only.*--runtime docker"):
        get_arm("a2f-keys").preflight("native")


def test_rig_arms_refuse_docker_where_they_have_none():
    for arm in ("baseline", "dub-ls"):
        with pytest.raises(ArmNotBuilt, match=f"docker runtime not implemented for {arm}"):
            get_arm(arm).preflight("docker")


def test_spoken_text_prefers_the_audio_txt_then_strips_comments(tmp_path: Path):
    def job(audio: Path, text: str) -> Job:
        return Job(arm="baseline", script="s", script_text=text, audio=audio, audio_s=1.0,
                   portrait=tmp_path / "p.png", seed=1, runtime="native", run_dir=tmp_path, log=tmp_path / "l")

    wav = tmp_path / "s.wav"
    assert spoken_text(job(wav, "# a comment\nHello there.\n\nSecond one.")).read_text() == "Hello there. Second one.\n"
    wav.with_suffix(".txt").write_text("from th audio", encoding="utf-8")
    assert spoken_text(job(wav, "ignored")) == wav.with_suffix(".txt")
