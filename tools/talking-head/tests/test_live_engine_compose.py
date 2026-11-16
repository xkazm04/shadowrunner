"""Round 2 picture stages without a GPU: the seam blend's frame arithmetic, the idle loop's live
weight and phase, the matte hook (a fake matte registered here only) and the alpha upscale."""

from __future__ import annotations

import io
import time

import numpy as np
import pytest
from PIL import Image

from th.live import compose as C
from th.live.engine import Engine, Line
from th.live.models import FakeModel


def frames(values, size: int = 8) -> np.ndarray:
    return np.stack([np.full((size, size, 3), v, np.uint8) for v in values])


def test_seam_holds_three_frames_and_blends_them_with_the_next_chunks_motion_twins():
    c = C.Compositor(blend=True)
    a = frames(range(0, 240, 10))  # 24 frames: 0, 10, ..., 230
    first, out = c.seam(0, a, None)
    assert first == 0 and len(out) == 21 and out[-1, 0, 0, 0] == 200  # 210/220/230 held
    b = frames([250] * 24)
    m = frames([100] * 6 + [40, 40, 40])  # motion frames 6..8 are the twins of a[21..23]
    first, out = c.seam(1, b, m)
    assert first == 24 - 3 and len(out) == 24  # frames 21..44: contiguous with chunk 0's 0..20
    # held a[21..23] = 210, 220, 230 mixed toward their twins (40) at 0.25 / 0.5 / 0.75
    assert out[:3, 0, 0, 0].tolist() == [round(210 * .75 + 40 * .25), round(220 * .5 + 40 * .5),
                                         round(230 * .25 + 40 * .75)]
    assert (out[3:] == 250).all()
    assert c.stats["seams"] == [1]


def test_seam_after_a_skipped_chunk_drops_the_held_frames_and_off_is_identity():
    c = C.Compositor(blend=True)
    c.seam(0, frames([1] * 24), None)
    first, out = c.seam(3, frames([9] * 24), frames([5] * 9))
    assert first == 72 and len(out) == 21 and (out == 9).all()
    off = C.Compositor(blend=False)
    x = frames([7] * 24)
    assert off.seam(0, x, None) == (0, x) and off.seam(1, x, x)[0] == 24


def test_compose_ramps_over_six_frames_and_lands_the_loop_near_the_live_pose():
    loop = frames(range(0, 100, 10))  # 10 loop frames, values 0..90
    c = C.Compositor(loop=loop, blend=False)
    assert c.w == 0.0
    live = frames([200] * 12)
    out, mode = c.compose(0, live, lambda pts: pts >= 4 * 40)  # live from frame 4
    vals = out[:, 0, 0, 0].astype(int)
    assert vals[:4].tolist() == [0, 10, 20, 30] and mode == "live"  # loop playing, phase 0..3
    w = np.array([1, 2, 3, 4, 5, 6, 6, 6]) / 6
    loop_part = np.array([40, 50, 60, 70, 80, 90, 0, 10])
    assert vals[4:].tolist() == np.rint(loop_part * (1 - w) + 200 * w).astype(int).tolist()
    # leaving live: the loop resumes at the frame nearest the live frame (value 60 for 57)
    live2 = frames([57] * 8)
    out2, mode2 = c.compose(12, live2, lambda pts: False)
    assert c.phase == 6 + 8 and mode2 == "loop"
    assert out2[0, 0, 0, 0] == round(60 / 6 + 57 * 5 / 6)  # w 5/6 on the loop's frame 6
    assert out2[5:, 0, 0, 0].tolist() == [10, 20, 30]  # w reaches 0 after 6 frames: pure loop
    assert C.Compositor().compose(0, live, lambda p: False) == (live, "live")  # no loop: live


def test_live_weight_follows_lines_with_hold_lead_and_tail():
    e = Engine(FakeModel(size=8, compute_s=0), lambda k, p: None)
    ln = Line("a", "x")
    ln.start_ms, ln.end_ms = 960.0, 2000.0
    e._spoken.append(ln)
    assert not e._live_at(960.0 - 4 * 40) and e._live_at(960.0 - 3 * 40)  # HOLD frames early
    assert e._live_at(5000.0)  # open line: live until it ends
    ln.done = True
    assert e._live_at(2000.0 + C.TAIL_MS) and not e._live_at(2000.0 + C.TAIL_MS + 1)
    ln.cut_ms = 1200.0
    assert not e._live_at(1500.0)
    e.source = "mic"
    assert e._live_at(99999.0)


class FakeMatte:
    """Left half opaque; numpy in, numpy out (the contract's CUDA tensors stand in as arrays)."""

    kind = "fake-test"

    def warmup(self) -> None:
        return None

    def __call__(self, fr: np.ndarray) -> np.ndarray:
        a = np.zeros(fr.shape[:3], np.uint8)
        a[:, :, : fr.shape[2] // 2] = 255
        return a


def test_engine_chunks_are_contiguous_and_matte_gives_alpha_pairs(monkeypatch):
    from th.live import stages
    from th.live.matte import kinds

    monkeypatch.setitem(kinds.KINDS, "fake-test", FakeMatte)
    monkeypatch.setattr(stages, "MATTE_KIND", "fake-test")
    e = Engine(FakeModel(size=16, compute_s=0), lambda k, p: None, matte=True)
    e._t0 = time.perf_counter()
    e.matte = e._load_matte()
    try:
        c0, c1 = e._compute(0), e._compute(1)
        assert (c0.pts_ms, len(c0.frames)) == (0.0, 21) and (c1.pts_ms, len(c1.frames)) == (840.0, 24)
        rgb, alpha = c1.frames[0].result()
        assert Image.open(io.BytesIO(rgb)).mode == "RGB"
        a = np.asarray(Image.open(io.BytesIO(alpha)))
        assert a.shape == (16, 16) and a[:, :6].mean() > 240 and a[:, 10:].mean() < 15
        assert len(e.stats["matteMs"]) == 2
    finally:
        e._pool.shutdown(wait=True)


def test_missing_matte_kind_sends_one_error_and_stays_off(monkeypatch):
    from th.live import stages

    monkeypatch.setattr(stages, "MATTE_KIND", "no-such-kind")
    ev: list = []
    e = Engine(FakeModel(size=8, compute_s=0), lambda k, p: ev.append((k, p)))
    assert e._load_matte() is None and e.matte is None
    errs = [p["text"] for k, p in ev if k == "event" and p["kind"] == "error"]
    assert len(errs) == 1 and "no-such-kind" in errs[0]


def test_alpha_upscale_is_bilinear_at_the_frame_factor():
    a = np.zeros((2, 4, 4), np.uint8)
    a[:, :, 2:] = 255
    up = C.upscale_alpha(a, 2)
    assert up.shape == (2, 8, 8) and up[0, 0, 0] == 0 and up[0, 0, 7] == 255
    assert 0 < up[0, 0, 3] < 255 or 0 < up[0, 0, 4] < 255  # a soft edge, not nearest
    assert C.upscale_alpha(a, 1) is a


@pytest.mark.skipif(not __import__("torch").cuda.is_available(), reason="needs CUDA")
def test_torch_paths_match_numpy():
    import torch

    a, b = frames([10, 20, 30]), frames([110, 120, 130])
    t = C.mix(torch.from_numpy(a).cuda(), torch.from_numpy(b).cuda(), C.SEAM_W).cpu().numpy()
    assert np.array_equal(t, C.mix(a, b, C.SEAM_W))
    al = np.zeros((1, 4, 4), np.uint8)
    al[:, :, 2:] = 255
    tu = C.upscale_alpha(torch.from_numpy(al).cuda(), 2).cpu().numpy()
    assert tu.shape == (1, 8, 8) and tu[0, 0, 0] == 0 and tu[0, 0, 7] == 255


def test_adaptive_lookahead_follows_the_slowest_recent_chunk(monkeypatch):
    from th.live import engine as eng
    from th.live import stages

    e = Engine(FakeModel(size=8, compute_s=0), lambda k, p: None)
    assert e.lookahead() == eng.LATEST_MS == 960.0  # no history yet: the safe ceiling
    e.stats["chunkMs"] += [560.0, 570.0, 590.0]
    assert e.lookahead() == 3 * 40 + 590 + stages.LOOKAHEAD_MARGIN_MS  # 860: the held frames' lead
    e.stats["chunkMs"] += [400.0] * 8
    assert e.lookahead() == stages.LOOKAHEAD_FLOOR_MS  # fast chunks: the floor
    e.stats["chunkMs"].append(760.0)  # matting switched on: the next chunk already waits longer
    assert e.lookahead() == 960.0
    monkeypatch.setattr(eng, "LOOKAHEAD_AUTO", False)
    e.stats["chunkMs"] += [400.0] * 8
    assert e.lookahead() == eng.LATEST_MS  # TH_LIVE_LOOKAHEAD_MS fixes it
