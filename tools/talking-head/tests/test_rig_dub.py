"""dub-ls set-up rules that need no GPU: insightface never reaches the arm env, and the MediaPipe
adapter hands LatentSync exactly the three alignment points."""

import numpy as np
import pytest

from th.arms.dub import DROPPED, stripped_requirements
from th.rig import ls_face

UPSTREAM = """torch==2.5.1
torchvision==0.20.1
--extra-index-url https://download.pytorch.org/whl/cu121
diffusers==0.32.2
mediapipe==0.10.11
gradio==5.24.0
insightface==0.7.3
onnxruntime-gpu==1.21.0
DeepCache==0.1.1"""


def test_insightface_and_its_runtime_are_stripped_torch_is_cuda():
    out = stripped_requirements(UPSTREAM)
    for name in DROPPED:
        assert name not in out
    assert "torch==2.5.1+cu121" in out and "torchvision==0.20.1+cu121" in out
    assert "--extra-index-url https://download.pytorch.org/whl/cu121" in out
    assert "mediapipe==0.10.11" in out and "DeepCache==0.1.1" in out


def test_adapter_points_survive_latentsyncs_own_reads():
    lm = np.zeros((478, 2))
    lm[list(ls_face.BROW_A)] = (600.0, 300.0)  # the subject's right brow drawn on the image's right
    lm[list(ls_face.BROW_B)] = (420.0, 310.0)
    lm[list(ls_face.NOSE)] = (515.0, 400.0)
    pts = ls_face.three_points(lm)
    assert pts[0].tolist() == [420.0, 310.0]  # image-left first, as the template wants
    lmk = ls_face.as_106(pts)
    # image_processor.affine_transform's own indexing
    left = np.mean(lmk[[43, 48, 49, 51, 50]], axis=0)
    right = np.mean(lmk[101:106], axis=0)
    nose = np.mean(lmk[[74, 77, 83, 86]], axis=0)
    assert np.allclose([left, right, nose], pts)


def test_pingpong_follows_latentsyncs_loop():
    from th.rig.dub_paste import pingpong

    assert [pingpong(k, 3) for k in range(8)] == [0, 1, 2, 2, 1, 0, 0, 1]


def test_paste_mode_flag(monkeypatch):
    from th.rig import dub_paste

    monkeypatch.delenv("TH_DUB_PASTE", raising=False)
    assert dub_paste.mode() == "mouth"
    monkeypatch.setenv("TH_DUB_PASTE", "crop")
    assert dub_paste.mode() == "crop"
    monkeypatch.setenv("TH_DUB_PASTE", "face")
    with pytest.raises(SystemExit, match="TH_DUB_PASTE"):
        dub_paste.mode()


def test_mask_is_feathered_and_pads_the_jaw():
    from th.rig import dub_paste

    pts = np.zeros((478, 2), np.float32)
    pts[list(dub_paste.MOUTH_CENTRE)] = (200, 200)
    # a 100 px half-disc for the oval below, the upper line straight at y = 170
    for i, idx in enumerate(dub_paste.OVAL):
        a = np.pi * i / (len(dub_paste.OVAL) - 1)
        pts[idx] = (200 - 100 * np.cos(a), 200 + 100 * np.sin(a))
    for i, idx in enumerate(dub_paste.UPPER):
        pts[idx] = (300 - 200 * i / (len(dub_paste.UPPER) - 1), 170)
    poly = dub_paste.polygon(pts)
    assert poly[len(dub_paste.OVAL) // 2][1] == pytest.approx(300 + dub_paste.JAW_PAD_PX, abs=1)
    m = dub_paste.mask(poly, (400, 400))[..., 0]
    assert m[230, 200] > 0.99 and m[20, 200] < 0.01      # inside, far outside
    assert m[300, 200] > 0.9                              # the jaw line is inside the mask
    edge = m[170 - 30:170 + 30, 200]
    assert 0.3 < m[170, 200] < 0.7 and np.all(np.diff(edge) >= -1e-6)  # a gradient, no step
