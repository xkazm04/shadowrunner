"""Head-only motion (th/live/headlayer.py, round 4): the head moves, the body and backdrop pixels stay
identical; the weight map's shape; numpy and torch agree; the map refresh off the GPU thread."""

from __future__ import annotations

import time

import numpy as np
import pytest

from th.live.headlayer import BODY, CLOTHES, FACE, HAIR, HeadLayer, geometric_conf, weights

SIZE = 128


def _frames(n: int = 3, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (n, SIZE, SIZE, 3), dtype=np.uint8)


def _params(*rows) -> np.ndarray:
    return np.array([[*r, 1.0] for r in rows], np.float32)  # dx, dy (px at 512), rot, scale, weight


def test_a_moving_head_leaves_body_and_backdrop_pixels_identical():
    layer = HeadLayer.geometric(SIZE)
    f = _frames()
    p = _params((12, 6, 3.0, 1.0), (-8, 4, -2.5, 0.995), (0, 0, 0, 1))
    out, _ = layer.apply(f, p)
    still = layer.w == 0
    assert still.mean() > 0.4  # the clothes and the far backdrop
    assert np.array_equal(out[:, still], f[:, still])  # bit for bit, every moving frame
    conf = geometric_conf(SIZE)
    clothes = conf[..., CLOTHES] > 0.5
    assert np.array_equal(out[:2, clothes], f[:2, clothes])  # the shoulders never move
    head = conf[..., FACE] > 0.5
    assert np.abs(out[0, head].astype(int) - f[0, head]).mean() > 20  # the head did move
    assert np.array_equal(out[2], f[2])  # the identity is exact


def test_the_head_moves_rigidly_by_the_transform():
    layer = HeadLayer.geometric(SIZE)
    f = np.full((1, SIZE, SIZE, 3), 60, np.uint8)
    f[:, 40:44, 60:64] = 255  # a marker inside the head
    out, _ = layer.apply(f, _params((5 * 512 / SIZE, 0, 0, 1)))  # dx = 5 px at this size
    ys, xs = np.nonzero(out[0, :, :, 0] > 200)
    assert (xs.min(), ys.min(), xs.max(), ys.max()) == (65, 40, 68, 43)


def test_frame_and_alpha_move_together():
    layer = HeadLayer.geometric(SIZE)
    f = np.full((1, SIZE, SIZE, 3), 60, np.uint8)
    f[:, 40:44, 60:64] = 255
    al = np.zeros((1, SIZE, SIZE), np.uint8)
    al[:, 40:44, 60:64] = 255
    out, oal = layer.apply(f, _params((0, 4 * 512 / SIZE, 0, 1)), al)
    assert np.array_equal(out[0, :, :, 0] > 200, oal[0] > 200)
    assert np.nonzero(oal[0] > 200)[0].min() == 44


def test_weight_map_head_one_clothes_zero_neck_fades_downward():
    conf = geometric_conf(SIZE)
    conf[30:50, 40:88] = 0
    conf[30:50, 40:88, HAIR] = 1  # hair on top of the face ellipse
    w, pivot, info = weights(conf)
    head = np.isin(conf.argmax(-1), (HAIR, FACE))
    inner = head.copy()
    inner[1:-1, 1:-1] = head[:-2, 1:-1] & head[2:, 1:-1] & head[1:-1, :-2] & head[1:-1, 2:] & head[1:-1, 1:-1]
    assert (w[inner] == 1).all()
    assert (w[conf[..., CLOTHES] > 0.5] < 0.05).all()
    col = w[:, SIZE // 2]
    neck = np.nonzero(conf[:, SIZE // 2, BODY] > 0.5)[0]
    assert col[neck[0]] > 0.9 and col[neck[-1]] < col[neck[0]]
    assert np.all(np.diff(col[int(info["chin"]):neck[-1]]) <= 1e-6)  # bends: never increases downward
    assert abs(pivot[0] - SIZE / 2) < 2 and pivot[1] > info["chin"]


def test_numpy_and_torch_paths_agree():
    torch = pytest.importorskip("torch")
    layer = HeadLayer.geometric(SIZE)
    f = _frames(2, 1)
    al = np.random.default_rng(2).integers(0, 256, (2, SIZE, SIZE), dtype=np.uint8)
    p = _params((9, -5, 2.0, 1.003), (-4, 7, -1.2, 0.997))
    a, aa = layer.apply(f, p, al)
    b, ba = layer.apply(torch.from_numpy(f), p, torch.from_numpy(al))
    assert np.abs(a.astype(int) - b.numpy()).max() <= 1
    assert np.abs(aa.astype(int) - ba.numpy()).max() <= 1
    still = layer.w == 0
    assert np.array_equal(b.numpy()[:, still], f[:, still])


class _FakeSeg:
    def __init__(self, conf: np.ndarray) -> None:
        self.conf, self.calls = conf, 0

    def __call__(self, frame: np.ndarray) -> np.ndarray:
        self.calls += 1
        time.sleep(0.05)
        return self.conf

    def close(self) -> None:
        pass


def test_observe_refreshes_the_map_off_thread_and_skips_while_busy():
    conf = geometric_conf(SIZE)
    shifted = np.roll(conf, 6, axis=1)  # the head moved right in the live frames
    seg = _FakeSeg(shifted)
    layer = HeadLayer(conf, seg)
    w0 = layer.w.copy()

    def refresh() -> None:
        v = layer.version
        assert layer.observe(np.zeros((SIZE, SIZE, 3), np.uint8))
        assert not layer.observe(np.zeros((SIZE, SIZE, 3), np.uint8))  # one at a time: skipped
        for _ in range(200):
            if layer.version > v:
                return
            time.sleep(0.01)

    refresh()
    assert layer.version == 1 and seg.calls == 1
    assert np.allclose(layer._conf, 0.7 * conf + 0.3 * shifted)  # smoothed, not replaced
    assert np.array_equal(layer.w, w0)  # one frame does not flip a class yet
    refresh()
    assert layer.version == 2 and not np.array_equal(layer.w, w0)  # the second one does


def test_engine_moves_only_the_head_of_a_chunk():
    """Through the engine's motion stage (stages._move) with the fake model's geometric map."""
    from th.live.engine import Engine
    from th.live.models import FakeModel

    e = Engine(FakeModel(size=SIZE, compute_s=0), lambda *a: None, motion="lively")
    for _ in range(200):
        if e.head is not None:
            break
        time.sleep(0.01)
    t = np.arange(16000 * 24 // 25 * 2) / 16000
    e.motion.feed(0, (0.1 * np.sin(2 * np.pi * 3 * t) * np.sin(2 * np.pi * 220 * t)).astype(np.float32))
    f = _frames(24, 3)
    out, _ = e._move(24, f, None)  # the second chunk: the level has eased in
    still = e.head.w == 0
    assert np.array_equal(out[:, still], f[:, still]) and not np.array_equal(out, f)
    assert len(e.stats["motionMs"]) == 1 and len(e.stats["motion"]) == 24
    e._pool.shutdown(wait=False)  # never started: nothing else to stop
