import importlib
import sys
from pathlib import Path

import pytest

from th.arms import REGISTRY, ArmEnv, Job, get_arm
from th.arms.base import Arm, ArmNotBuilt, StubArm
from th.schema import ARM_IDS

MODULES = {
    "noop": "noop", "baseline": "baseline", "diffusion-it": "infinitetalk", "diffusion-sa": "stableavatar",
    "realtime-fh": "flashhead", "dub-ls": "dub", "a2f-keys": "a2f",
}


def job(tmp_path: Path, arm: str, runtime: str = "native") -> Job:
    return Job(arm=arm, script="smoke-6s", script_text="hi", audio=tmp_path / "a.wav", audio_s=1.0,
               portrait=tmp_path / "p.png", seed=1, runtime=runtime, run_dir=tmp_path,
               log=tmp_path / "log.txt")


def test_registry_covers_arm_ids_one_module_each():
    assert tuple(REGISTRY) == ARM_IDS
    for arm_id, module in MODULES.items():
        mod = importlib.import_module(f"th.arms.{module}")
        cls = REGISTRY[arm_id]
        assert cls.__module__ == mod.__name__
        assert issubclass(cls, Arm) and cls.id == arm_id


# Only arms still stubbed: a built arm (tasks 2-3) replaces its module and leaves this list.
@pytest.mark.parametrize("arm_id", [a for a in ARM_IDS if issubclass(REGISTRY[a], StubArm)])
def test_stubs_raise_not_implemented_naming_the_package(tmp_path, arm_id):
    arm = get_arm(arm_id)
    with pytest.raises(NotImplementedError, match=rf"^{arm_id}: WP[23]$"):
        arm.render(job(tmp_path, arm_id))
    with pytest.raises(NotImplementedError, match=arm_id):
        arm.fetch()


def test_docker_runtime_is_a_clear_error_by_default(tmp_path):
    noop = get_arm("noop")
    noop.preflight("native")
    with pytest.raises(ArmNotBuilt, match="^docker runtime not implemented for noop$"):
        noop.preflight("docker")  # th render checks this before audio, run dir or GPU lock
    with pytest.raises(ArmNotBuilt, match="docker runtime not implemented for noop"):
        noop.render(job(tmp_path, "noop", runtime="docker"))
    stubs = [a for a in ARM_IDS if issubclass(REGISTRY[a], StubArm)]
    for arm_id in stubs[:1]:  # empty once every arm is built
        with pytest.raises(ArmNotBuilt, match=rf"^{arm_id}: WP[23]$"):
            get_arm(arm_id).preflight("native")


def test_render_fails_fast_without_a_run_dir(tmp_path, monkeypatch):
    from th.render import render

    monkeypatch.setenv("TH_RUNS_DIR", str(tmp_path / "runs"))
    with pytest.raises(SystemExit, match="docker runtime not implemented for noop"):
        render("noop", "smoke-6s", runtime="docker")
    assert not (tmp_path / "runs").exists()


def test_unknown_arm_exits():
    with pytest.raises(SystemExit):
        get_arm("wav2lip")


def test_arm_env_layout_and_streaming_run(tmp_path, monkeypatch):
    monkeypatch.setenv("TH_HOME", str(tmp_path))
    env = ArmEnv("diffusion-it")
    assert env.repo == tmp_path / "repos" / "diffusion-it"
    assert env.env == tmp_path / "envs" / "diffusion-it"
    assert env.models == tmp_path / "models" / "diffusion-it"
    assert env.python.parent.parent == env.env
    log = tmp_path / "log.txt"
    secs = env.run([sys.executable, "-c", "print('hello from the arm')"], cwd=tmp_path, log=log)
    assert secs >= 0 and "hello from the arm" in log.read_text()
    with pytest.raises(RuntimeError, match="command failed"):
        env.run([sys.executable, "-c", "import sys; sys.exit(3)"], cwd=tmp_path, log=log)
