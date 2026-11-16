"""Small pure pieces: script parsing, box geometry, the GPU lock, normalise's letterbox."""

import threading

import numpy as np
import pytest
from conftest import make_clip, needs_ffmpeg

from th.audio import paragraphs, read_script
from th.ffmpeg import probe, read_frames, video_stream
from th.post.face import grow, square_crop, to_xywh, union
from th.post.syncnet import smooth_boxes


def test_scripts_exist_and_comments_are_not_spoken():
    for sid in ("pitch-45s", "long-180s", "smoke-6s"):
        text = read_script(sid)
        paras = paragraphs(text)
        assert paras and all(paras)
        assert not any("#" in s for p in paras for s in p)
    pitch = " ".join(" ".join(p) for p in paragraphs(read_script("pitch-45s")))
    assert "?" in pitch and "!" in pitch  # the rhetorical question and the excited beat


def test_box_geometry():
    assert grow((10, 10, 30, 20), 0.25) == (5.0, 7.5, 35.0, 22.5)
    assert union([(0, 0, 10, 10), (5, -2, 12, 8)]) == (0.0, -2.0, 12.0, 10.0)
    assert union([]) is None
    assert to_xywh((-3.2, 4.5, 50.1, 2000), (100, 100)) == [0, 4, 51, 96]
    crop = square_crop(np.zeros((100, 100, 3), np.uint8), (90, 90, 120, 110), 0.2, 64)
    assert crop.shape == (64, 64, 3)


def test_smooth_boxes_fills_gaps_and_rejects_empty():
    boxes = [(10.0, 10.0, 30.0, 30.0)] * 20
    boxes[5] = None
    out = smooth_boxes(boxes)
    assert out is not None and len(out) == 20 and out[5] == pytest.approx((10, 10, 30, 30))
    assert smooth_boxes([None] * 20) is None


def test_gpu_lock_is_exclusive(tmp_path, monkeypatch):
    from filelock import FileLock, Timeout

    from th.gpu import gpu_lock

    monkeypatch.setenv("TH_HOME", str(tmp_path))
    with gpu_lock():
        result = {}

        def other():
            try:
                FileLock(str(tmp_path / "gpu.lock")).acquire(timeout=0.2)
                result["got"] = True
            except Timeout:
                result["got"] = False

        t = threading.Thread(target=other)
        t.start()
        t.join()
        assert result["got"] is False
    with gpu_lock():
        pass  # released and re-acquirable


@needs_ffmpeg
def test_normalise_letterboxes_never_stretches(tmp_path):
    from th.post.normalise import normalise

    src = tmp_path / "wide.mp4"
    import subprocess

    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=white:size=640x360:rate=25:duration=1", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", str(src)], check=True)
    audio = make_clip(tmp_path / "tone.mp4", seconds=1.5)
    out = tmp_path / "video.mp4"
    normalise(src, audio, 1.5, out)
    info = probe(out)
    vs = video_stream(info)
    assert (vs["width"], vs["height"], vs["r_frame_rate"]) == (1080, 1080, "30/1")
    assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in info["streams"])
    assert abs(float(info["format"]["duration"]) - 1.5) < 0.1  # held to the audio clock
    frame = next(read_frames(out, (1080, 1080)))
    assert frame[20, 540].max() < 30  # top band is the pad (16:9 source in a square)
    assert frame[540, 540].min() > 220  # the picture keeps its aspect
