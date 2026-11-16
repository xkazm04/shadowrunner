import json

from conftest import make_clip, needs_ffmpeg

from th.board import assign, build
from th.ffmpeg import probe, video_stream


def test_assign_is_seeded_and_blind():
    runs = [f"r{i}" for i in range(6)]
    a1, a2 = assign(runs, 7), assign(runs, 7)
    assert a1 == a2 and list(a1) == list("ABCDEF") and sorted(a1.values()) == runs
    assert any(assign(runs, s) != a1 for s in range(8, 20))


@needs_ffmpeg
def test_board_grid_key_and_verdict(tmp_path):
    runs = []
    for i, secs in enumerate((2.0, 3.0)):
        d = tmp_path / f"run{i}"
        d.mkdir()
        make_clip(d / "video.mp4", seconds=secs, freq=440 + 220 * i)
        runs.append(d)
    out = tmp_path / "board"
    board = build(runs, seed=3, out=out)
    info = probe(board)
    vs = video_stream(info)
    assert (vs["width"], vs["height"]) == (1620, 1080)
    assert any(s["codec_type"] == "audio" for s in info["streams"])
    assert abs(float(info["format"]["duration"]) - 3.0) < 0.15  # padded to the longest
    key = json.loads((out / "key.json").read_text())
    assert key["schema"] == "th-board/1" and key["seed"] == 3
    assert sorted(key["letters"]) == ["A", "B"]
    assert sorted(v["run"] for v in key["letters"].values()) == sorted(map(str, runs))
    assert key["audioFrom"] == str(runs[0])
    verdict = (out / "verdict.md").read_text()
    assert "## A" in verdict and "## B" in verdict and "## C" not in verdict and "- pick:" in verdict
