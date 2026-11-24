"""iris-hands round 3 without a GPU or MediaPipe: the full arm's face box, config and driver, the
Flash re-anchoring options, the open-hands pose picker and the gesture persistence measure."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest

from th.experiments.hands import emv3, facebox, full, persist, reanchor
from th.experiments.hands.handcheck import FrameCheck, Hand
from th.schema import Weight

HERE = Path(full.__file__).parent


# --- full arm: face box ---------------------------------------------------------------------

def test_mask_coords_is_get_mask_coords_tuple_clamped() -> None:
    pts = np.array([[400.2, 250.7], [610.9, 260.0], [500.0, 480.1], [390.0, 300.0]])
    assert facebox.mask_coords(pts, 1024, 1536) == (250, 481, 390, 611, 1536, 1024)
    edge = np.array([[-5.0, -3.0], [30.0, 40.0]])
    assert facebox.mask_coords(edge, 100, 80) == (0, 40, 0, 30, 80, 100)
    with pytest.raises(ValueError):
        facebox.mask_coords(np.array([[5.0, 5.0], [5.0, 5.0]]), 10, 10)


def test_patch_grid_follows_upstream_scaling() -> None:
    # waist-c 1024 x 1536 -> sample 928 x 624 (768^2 area, 16-px grid); a face box stays non-empty
    y1, y2, x1, x2 = facebox.patch_grid((250, 481, 390, 611, 1536, 1024), (928, 624))
    r = (928 * 624 / 1536 / 1024) ** 0.5
    assert (y1, y2, x1, x2) == (250 * r // 16, 481 * r // 16, 390 * r // 16, 611 * r // 16)
    assert y2 > y1 and x2 > x1


# --- full arm: config and driver ------------------------------------------------------------

def _config() -> dict:
    return full.config(Path("data"), Path("work"), (1, 2, 3, 4, 5, 6), seed=7, steps=15,
                       text_cfg=4.0, audio_cfg=2.9, negative=full.NEGATIVES["none"],
                       neg_scale=1.0, neg_steps=0, long_cfg=True, audio_chunk=113)


def test_full_config_drives_upstream_names() -> None:
    cfg = _config()
    c = cfg["config"]
    assert c["num_inference_steps"] == 15 and c["use_longvideo_cfg"] is True
    assert c["negative_prompt"] == "" and c["neg_scale"] == 1.0 and c["neg_steps"] == 0
    assert c["test_name_list"] == [full.NAME] and c["base_dir"].endswith("/")
    assert c["wav2vec_model_dir"].endswith(full.W2V_DIR)
    assert c["enable_teacache"] is False
    assert cfg["face"] == [1, 2, 3, 4, 5, 6] and cfg["offload"] and cfg["audioChunk"] == 113
    assert "Bad hands" in full.NEGATIVES["upstream"]


def test_full_config_keys_exist_in_upstream_config() -> None:
    src = emv3.env().repo / "infer_preview.py"
    if not src.is_file():
        pytest.skip("hands-emv3 clone not present")
    attrs = set(re.findall(r"self\.(\w+)\s*=", src.read_text(encoding="utf-8")))
    assert set(_config()["config"]) <= attrs


def _driver_src() -> str:
    return (HERE / "full_driver.py").read_text(encoding="utf-8")


def test_full_driver_never_imports_retinaface() -> None:
    src = _driver_src()
    compile(src, "th_hands_full.py", "exec")
    assert 'sys.modules["src.face_detect"]' in src
    assert src.index('sys.modules["src.face_detect"]') < src.index("import infer_preview")
    code = src[src.index('"""', 3) + 3:].lower()   # the docstring names what is not loaded
    assert "retinaface" not in code and "insightface" not in code and "tensorflow" not in code
    assert "enable_model_cpu_offload" in src


def test_full_driver_chunk_spans_cover_each_frame_once() -> None:
    src = _driver_src()
    ns: dict = {}
    exec(src[src.index("def chunk_spans("):src.index("AUDIO_MARGIN = ")], ns)  # noqa: S102
    spans = ns["chunk_spans"](425, 113, 25)
    assert [(s, e) for s, e, _, _ in spans] == [(0, 113), (113, 226), (226, 339), (339, 425)]
    assert spans[1][2:] == (88, 251) and spans[-1][3] == 425 and spans[0][2] == 0


def test_licence_rows_keep_the_flash_row() -> None:
    flash = Weight(name="BadToBest/EchoMimicV3 (flash)", licence="Apache-2.0", url="u", revision="r")
    rows = full.merge_rows([flash], full.weight_rows())
    assert rows[0] == flash and len(rows) == 3
    assert full.merge_rows(rows, full.weight_rows()) == rows
    assert all("Apache-2.0" in w.licence for w in rows)
    assert "3.41 GB" in rows[1].name


# --- Flash re-anchoring ---------------------------------------------------------------------

def test_flash_driver_reanchor_pick_repeats_the_last() -> None:
    src = (HERE / "flash_driver.py").read_text(encoding="utf-8")
    ns: dict = {}
    exec(src[src.index("def pick("):src.index("def _pose(")], ns)  # noqa: S102
    assert ns["pick"]([], 3) is None
    assert [ns["pick"](["a", "b"], k) for k in range(4)] == ["a", "b", "b", "b"]
    assert "TH_EMV3_REANCHOR" in src and '"clip_image": clip_k' in src


def test_driver_env_carries_the_reanchor_file(tmp_path: Path) -> None:
    assert "TH_EMV3_REANCHOR" not in emv3.driver_env(True, False, 121)
    env = emv3.driver_env(True, False, 121, reanchor=tmp_path / "r.json")
    assert env["TH_EMV3_REANCHOR"] == str(tmp_path / "r.json")


def test_beat_prompts_one_per_window() -> None:
    ps = reanchor.beat_prompts()
    assert len(ps) == len(emv3.window_plan(425)) == 4
    assert "one finger" in ps[1] and "two fingers" in ps[2] and "palms" in ps[3]
    assert all(p.startswith(reanchor.HEAD) for p in ps)


def _hand(wrist: tuple[float, float], spread: float) -> Hand:
    """A hand: wrist, middle base 40 px up, fingertips `spread` x the palm length from the wrist."""
    xy = np.zeros((21, 2), np.float32)
    xy[:] = wrist
    xy[9] = (wrist[0], wrist[1] - 40)
    for t in reanchor.TIPS:
        xy[t] = (wrist[0], wrist[1] - 40 * spread)
    for k in range(21):  # give the box some width so the two hands' boxes do not meet
        xy[k, 0] += (k % 3) * 4
    return Hand(xy, np.zeros((21, 3), np.float32), 0.99)


def test_openness_separates_fist_and_open_hand() -> None:
    assert reanchor.openness(_hand((100, 500), 1.0).xy) == pytest.approx(1.0, abs=0.05)
    assert reanchor.openness(_hand((100, 500), 2.0).xy) == pytest.approx(2.0, abs=0.05)


def test_pick_pose_wants_raised_open_unflagged_hands() -> None:
    frames = [[_hand((100, 600), 2.0), _hand((400, 600), 2.0)],   # open, low
              [_hand((100, 400), 2.0), _hand((400, 400), 2.0)],   # open, raised -> but flagged next
              [_hand((100, 380), 2.0), _hand((400, 380), 2.0)],
              [_hand((100, 300), 1.0), _hand((400, 300), 1.0)],   # fists, highest
              [_hand((100, 450), 2.0), _hand((400, 450), 2.0)]]
    checks = [FrameCheck(2), FrameCheck(2), FrameCheck(2), FrameCheck(2), FrameCheck(2)]
    assert reanchor.pick_pose(frames, checks, margin=0) == 2
    checks[2].flags.append("1:jump=0.2")
    assert reanchor.pick_pose(frames, checks, margin=0) == 1
    assert reanchor.pick_pose(frames, checks, margin=1) == 4
    assert reanchor.pick_pose(frames[3:4], checks[3:4]) is None


# --- gesture persistence --------------------------------------------------------------------

def _wrists(n: int, amp_by_window: list[float], win: int, face_h: float = 100.0) -> np.ndarray:
    w = np.full((n, 2, 2), np.nan)
    t = np.arange(n)
    amp = np.array([amp_by_window[min(i // win, len(amp_by_window) - 1)] for i in t]) * face_h
    w[:, 0, 0] = 200 + amp * np.sin(t / 3)
    w[:, 0, 1] = 500.0
    w[:, 1] = w[:, 0] + [300, 0]
    return w


def test_window_travel_in_face_heights() -> None:
    w = _wrists(100, [0.5], 100)
    assert persist.window_travel(w, 100.0) == pytest.approx(1.0, abs=0.05)  # p95-p5 of a +-0.5 sine
    w[:, :, :] = np.nan
    assert persist.window_travel(w, 100.0) == 0.0


def test_persistence_holds_only_when_every_later_window_keeps_60_percent() -> None:
    plan = [(0, 100), (100, 100), (200, 100), (300, 100)]
    rest = np.zeros(400, bool)
    fades = persist.persistence(_wrists(400, [0.5, 0.4, 0.2, 0.5], 100), rest, 100.0, plan)
    assert fades["holds"] is False and fades["minLaterOverFirst"] == pytest.approx(0.4, abs=0.03)
    keeps = persist.persistence(_wrists(400, [0.5, 0.35, 0.4, 0.6], 100), rest, 100.0, plan)
    assert keeps["holds"] is True and [r["window"] for r in keeps["windows"]] == [0, 1, 2, 3]
    one = persist.persistence(_wrists(100, [0.5], 100), rest[:100], 100.0, [(0, 100)])
    assert one["holds"] is None


def test_clasped_rest_needs_clasped_and_still_hands() -> None:
    w = np.zeros((6, 2, 2))
    w[3:, 0, 0] = np.array([0, 10, 20]) * 1.0   # wrist moving 10 px/frame from frame 3
    speed = persist.speeds(w, 100.0, radius=0)
    assert speed[1] == 0.0 and speed[4] == pytest.approx(0.05)   # 10 px of 2 wrists / 100 px
    checks = [FrameCheck(0, 2), FrameCheck(0, 2), FrameCheck(2, 0), FrameCheck(0, 2),
              FrameCheck(0, 2), FrameCheck(1, 1)]
    assert persist.clasped_rest(checks, speed).tolist() == [False, True, False, True, False, False]


def test_drivers_compile_on_the_venv_python() -> None:
    """The drivers run on their venvs' Python 3.10 (no PEP 701 f-strings)."""
    import subprocess

    from th.experiments.hands import longcat

    pairs = [(emv3.env().python, "full_driver.py"), (emv3.env().python, "flash_driver.py"),
             (longcat.env().python, "longcat_driver.py")]
    if not any(py.is_file() for py, _ in pairs):
        pytest.skip("no driver venv built")
    for py, f in pairs:
        if not py.is_file():
            continue
        src = (HERE / f).read_text(encoding="utf-8")
        r = subprocess.run([str(py), "-c", "import sys; compile(sys.stdin.read(), 'd', 'exec')"],
                           input=src, capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert r.returncode == 0, r.stderr


# --- LongCat (internal comparison only) -----------------------------------------------------

def test_longcat_segments_cover_the_line() -> None:
    from th.experiments.hands import longcat

    assert longcat.segments_for(93) == 1
    assert longcat.segments_for(125) == 2     # 93 + 80 = 173 >= 125
    assert longcat.segments_for(425) == 6     # 93 + 5 x 80 = 493 >= 425; 4 x 80 falls short
    for n in (94, 173, 174, 425, 600):
        k = longcat.segments_for(n)
        assert 93 + (k - 1) * 80 >= n > 93 + (k - 2) * 80


def test_longcat_command_is_single_gpu_int8_distilled(tmp_path: Path) -> None:
    from th.experiments.hands import longcat

    argv = longcat.command(tmp_path / "in.json", tmp_path / "w", 6)
    assert argv[:2] == ["python", "th_hands_longcat.py"]
    assert "--use_int8" in argv and "--use_distill" in argv and "torchrun" not in argv
    assert argv[argv.index("--context_parallel_size") + 1] == "1"
    assert argv[argv.index("--num_segments") + 1] == "6"
    assert longcat.INTERNAL["internalOnly"] is True
    assert "audio-separator" not in " ".join(longcat.DEPS)


def test_longcat_driver_seed_patch_and_no_separator() -> None:
    src = (HERE / "longcat_driver.py").read_text(encoding="utf-8")
    ns: dict = {}
    exec(src[src.index("def _demo_source("):src.index("def main(")], ns)  # noqa: S102
    demo = Path(__file__).parent / "_demo_fixture.py"
    try:
        demo.write_text("a = 1\n    global_seed = 42\nb = 2\n", encoding="utf-8")
        assert "global_seed = 7\n" in ns["_demo_source"](str(demo), "7")
        demo.write_text("global_seed = 43\n", encoding="utf-8")
        with pytest.raises(SystemExit):
            ns["_demo_source"](str(demo), "7")
    finally:
        demo.unlink(missing_ok=True)
    code = src[src.index('"""', 3) + 3:]
    assert 'sys.modules.update({"audio_separator"' in code
    assert code.index("sys.modules.update") < code.index("from longcat_video")


def test_full_driver_cfg_split_matches_the_batched_call() -> None:
    """Splitting the three CFG branches gives each sample its own text, audio, mask and image."""
    import torch

    src = _driver_src()
    calls: list[int] = []

    def stub(self, x, t, context, seq_len, clip_fea=None, y=None):
        text, audio, _lt, ip_mask, scale = context
        calls.append(x.shape[0])
        tx = torch.stack([u.sum() for u in text]).view(-1, 1)
        return (x + t.view(-1, 1) + tx + audio.sum(1, keepdim=True) + ip_mask.sum(1, keepdim=True)
                + clip_fea.sum(1, keepdim=True) + y) * scale

    ns: dict = {"torch": torch, "_forward": stub}
    exec(src[src.index("def _split_forward("):src.index("_t5_load = ")], ns)  # noqa: S102
    g = torch.Generator().manual_seed(0)
    x, y = torch.randn(3, 4, generator=g), torch.randn(3, 4, generator=g)
    ctx = ([torch.randn(5, 2, generator=g) for _ in range(3)], torch.randn(3, 6, generator=g), 7,
           torch.randn(3, 8, generator=g), 0.5)
    t, clip = torch.randn(3, generator=g), torch.randn(3, 9, generator=g)
    whole = stub(None, x, t, ctx, 99, clip_fea=clip, y=y)
    calls.clear()
    split = ns["_split_forward"](None, x, t, ctx, 99, clip_fea=clip, y=y)
    assert calls == [1, 1, 1]
    assert torch.allclose(whole, split)


def test_flash_windows_keep_motion_frames_and_the_end_pose(tmp_path: Path, monkeypatch) -> None:
    """The windowed call with a stub pipeline: window k > 0 keeps the last 9 frames of the clip
    so far (mask 0), gets its own prompt and CLIP pose, and with endPose its last frame is the
    pose, kept."""
    import json
    import types

    import torch
    from PIL import Image

    src = (HERE / "flash_driver.py").read_text(encoding="utf-8")
    seen: list[dict] = []

    def call(_self, prompt, **kw):
        seen.append({"prompt": prompt, **kw})
        n = kw["num_frames"]
        return types.SimpleNamespace(videos=torch.full((1, 3, n, 4, 6), float(len(seen))))

    ns: dict = {"os": __import__("os"), "json": json, "math": __import__("math"), "torch": torch,
                "_call": call, "WanPipelineOutput": lambda videos: videos}
    exec(src[src.index("def plan("):src.index("_embed = ")], ns)  # noqa: S102
    pose = tmp_path / "pose.png"
    Image.new("RGB", (6, 4), (255, 0, 0)).save(pose)
    cfg = tmp_path / "r.json"
    cfg.write_text(json.dumps({"prompts": ["a", "b"], "poses": ["", str(pose)], "endPose": True}))
    monkeypatch.setenv("TH_EMV3_WINDOW", "121")
    monkeypatch.setenv("TH_EMV3_OVERLAP", "9")
    monkeypatch.setenv("TH_EMV3_REANCHOR", str(cfg))
    ref = Image.new("RGB", (6, 4), (0, 0, 255))
    out = ns["_windowed"](None, "base", num_frames=225, video=torch.zeros(1, 3, 225, 4, 6),
                          audio_embeds=torch.zeros(1, 225, 5), clip_image=ref)
    assert out.shape[2] == 225 and [s["prompt"] for s in seen] == ["a", "b"]
    assert seen[0]["clip_image"] is ref and seen[1]["clip_image"].getpixel((0, 0)) == (255, 0, 0)
    m1, v1 = seen[1]["mask_video"], seen[1]["video"]
    assert (m1[:, :, :9] == 0).all() and (m1[:, :, 9:-1] == 255).all() and (m1[:, :, -1] == 0).all()
    assert torch.allclose(v1[:, :, :9], torch.ones(1)) and v1[0, 0, -1].min() == 1.0
    assert v1[0, 2, -1].max() == 0.0          # the red pose, not the blue reference
    assert (seen[0]["mask_video"][:, :, -1] == 255).all()   # the first window has no end pose


def test_run_retries_only_the_access_violation(tmp_path: Path, monkeypatch) -> None:
    from th.experiments.hands import run as runmod

    assert runmod.is_access_violation("x: command failed (3221225477): python ...")
    assert not runmod.is_access_violation("x: command failed (1): python ...")

    class Env:
        repo = tmp_path
        calls = 0

        def run(self, *a, **k):
            Env.calls += 1
            if Env.calls == 1:
                raise RuntimeError("command failed (3221225477): python d.py")

    monkeypatch.setenv("TH_GPU_LOCK", str(tmp_path / "gpu.lock"))
    monkeypatch.setattr(runmod, "check", lambda: type("H", (), {"line": lambda s: "",
                                                                "driver_errors": None})())
    rec = runmod.run("c", Env(), ["python"], tmp_path / "o", {})
    assert Env.calls == 2 and rec.error is None and "retried" in rec.notes[0]

    class Bad(Env):
        def run(self, *a, **k):
            Env.calls += 1
            raise RuntimeError("command failed (1): python d.py")

    Env.calls = 0
    with pytest.raises(SystemExit):
        runmod.run("c", Bad(), ["python"], tmp_path / "o2", {})
    assert Env.calls == 1
