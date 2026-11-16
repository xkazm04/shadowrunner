"""End to end on the GPU: noop arm over the smoke script -> run dir with raw, video, alpha, run.json.
Also the SyncNet positive control (syncnet_python's example clip)."""

from pathlib import Path

import pytest
from conftest import needs_gpu_stack

from th.ffmpeg import has_audio, probe, read_frames, video_stream
from th.paths import models_dir
from th.post.alpha import decoded_alpha
from th.schema import load_run


@pytest.fixture(scope="module")
def noop_run(tmp_path_factory) -> Path:
    import os

    from th.render import render

    old = os.environ.get("TH_RUNS_DIR")
    os.environ["TH_RUNS_DIR"] = str(tmp_path_factory.mktemp("runs"))
    try:
        return render("noop", "smoke-6s", seed=7)
    finally:
        if old is None:
            os.environ.pop("TH_RUNS_DIR")
        else:
            os.environ["TH_RUNS_DIR"] = old


@needs_gpu_stack
def test_run_dir_layout(noop_run):
    for name in ("raw.mp4", "video.mp4", "alpha.webm", "run.json", "log.txt"):
        assert (noop_run / name).is_file(), name
    assert noop_run.name.endswith("-noop-smoke-6s")


@needs_gpu_stack
def test_video_is_normalised(noop_run):
    info = probe(noop_run / "video.mp4")
    vs = video_stream(info)
    assert (vs["codec_name"], vs["width"], vs["height"], vs["r_frame_rate"]) == ("h264", 1080, 1080, "30/1")
    assert has_audio(info)


@needs_gpu_stack
def test_alpha_is_real_on_decoded_pixels(noop_run):
    rec = load_run(noop_run / "run.json")
    assert probe(noop_run / "alpha.webm")["streams"][0]["codec_name"] == "vp9"
    rgba = decoded_alpha(noop_run / "alpha.webm", index=10)
    assert rgba.shape == (1080, 1080, 4)
    a = rgba[:, :, 3]
    for y, x in ((4, 4), (4, 1075), (1075, 4)):
        assert a[y, x] == 0, (y, x, a[y, x])
    # the face centre: the middle of the mouth ROI's top edge is between nose and lips
    x, y, w, h = rec.faceRoi
    assert a[y, x + w // 2] == 255
    assert a[y - h, x + w // 2] == 255  # nose / cheeks


@needs_gpu_stack
def test_run_json_validates_and_measures_noop(noop_run):
    rec = load_run(noop_run / "run.json")
    assert rec.arm == "noop" and rec.script == "smoke-6s" and rec.seed == 7
    assert (rec.width, rec.height, rec.fps) == (1080, 1080, 30.0)
    assert rec.identity.mean is not None and rec.identity.mean > 0.98  # the portrait itself
    assert rec.sync.conf is not None and rec.sync.conf < 1.0  # a still face has no lip sync
    assert rec.sync.offsetFrames is None
    assert rec.ttffMs is None  # noop emits no frame callback
    x, y, w, h = rec.faceRoi
    assert 400 < x < 540 < x + w < 680 and 450 < y < y + h < 650  # Iris's mouth, 1080 px frame
    assert {w.licence for w in rec.weights} >= {"MIT", "Apache-2.0"}


@needs_gpu_stack
def test_syncnet_positive_control():
    from th.post import syncnet
    from th.post.metrics import audio_16k

    clip = models_dir("syncnet") / "example.avi"
    if not clip.is_file():
        pytest.skip("example.avi not fetched (th fetch syncnet --force)")
    crops = [f[:, :, ::-1] for f in read_frames(clip, (224, 224))]
    conf, offset = syncnet.evaluate(crops, audio_16k(clip))
    assert offset == 3 and conf == pytest.approx(10.02, abs=0.3)  # syncnet_python README values
    late = syncnet.evaluate([crops[0]] * 5 + crops, audio_16k(clip))
    assert late[1] == 8  # picture 5 frames later -> offset +5
