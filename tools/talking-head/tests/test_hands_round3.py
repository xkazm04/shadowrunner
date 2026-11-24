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
