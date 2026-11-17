"""`th board reveal`: parse the filled blind verdict, unblind it against key.json and each run.json."""

import json

import pytest
from test_schema import record

from th.cli import _parser
from th.reveal import VerdictError, parse_verdict, reveal


def verdict(picks: dict[str, tuple[str, str]], winner: str = "A", why: str = "") -> str:
    lines = ["# Board verdict", "", "Blind board, seed 3.", ""]
    for x, (pick, notes) in picks.items():
        lines += [f"## {x}", "", f"- pick: {pick}", f"- notes: {notes}", ""]
    lines += ["## Overall", "", f"- winner: {winner}", f"- why: {why}", ""]
    return "\n".join(lines)


def make_board(tmp_path, runs: dict[str, dict | str | None], picks, winner="A"):
    """runs: letter -> run.json overrides (dict), raw text (str, invalid), or None (no run.json)."""
    letters = {}
    for x, rec in runs.items():
        d = tmp_path / f"run-{x}"
        d.mkdir()
        if isinstance(rec, dict):
            (d / "run.json").write_text(json.dumps(record(**rec)), encoding="utf-8")
        elif isinstance(rec, str):
            (d / "run.json").write_text(rec, encoding="utf-8")
        arm = rec.get("arm") if isinstance(rec, dict) else None
        letters[x] = {"run": str(d), "arm": arm, "script": "pitch-45s", "seed": 1116}
    board = tmp_path / "board"
    board.mkdir()
    key = {"schema": "th-board/1", "seed": 3, "audioFrom": letters["A"]["run"], "durationS": 2.0,
           "letters": letters}
    (board / "key.json").write_text(json.dumps(key), encoding="utf-8")
    (board / "verdict.md").write_text(verdict(picks, winner), encoding="utf-8")
    return board


TWO_RUNS = {
    "A": {"arm": "dub-ls", "sync": {"conf": 9.18, "offsetFrames": 0},
          "identity": {"mean": 0.98, "min": 0.946, "p5": 0.95}, "rtf": 12.8, "vramPeakMiB": 20582},
    "B": {"arm": "baseline", "sync": {"conf": 5.58, "offsetFrames": 1},
          "identity": {"mean": None, "min": None, "p5": None}, "rtf": None, "vramPeakMiB": None},
}


def test_parse_verdict_reads_picks_notes_and_winner():
    v = parse_verdict(verdict({"A": ("keep", "best mouth"), "B": ("Maybe", "")}, winner="a", why="sync"))
    assert v.picks == {"A": {"pick": "keep", "notes": "best mouth"}, "B": {"pick": "maybe", "notes": ""}}
    assert v.winner == "A" and v.why == "sync"


@pytest.mark.parametrize("pick", ["", "great"])
def test_blank_or_unknown_pick_names_letter_and_allowed_set(tmp_path, pick):
    with pytest.raises(VerdictError, match=r"B.*keep/maybe/drop"):
        parse_verdict(verdict({"A": ("keep", ""), "B": (pick, "")}))
    board = make_board(tmp_path, TWO_RUNS, {"A": ("keep", ""), "B": (pick, "")})
    with pytest.raises(VerdictError):
        reveal(board)
    assert not (board / "reveal.json").exists() and not (board / "reveal.md").exists()


def test_verdict_letters_must_match_key(tmp_path):
    runs = {**TWO_RUNS, "C": {"arm": "noop"}}
    board = make_board(tmp_path, runs, {"A": ("keep", ""), "B": ("drop", "")})
    with pytest.raises(VerdictError, match=r"missing C"):
        reveal(board)
    (board / "verdict.md").write_text(verdict({x: ("maybe", "") for x in "ABCG"}), encoding="utf-8")
    with pytest.raises(VerdictError, match=r"extra G"):
        reveal(board)
    assert not (board / "reveal.json").exists()


def test_winner_must_be_a_letter_and_not_dropped():
    with pytest.raises(VerdictError, match="winner"):
        parse_verdict(verdict({"A": ("keep", ""), "B": ("maybe", "")}, winner="Z"))
    with pytest.raises(VerdictError, match="winner"):
        parse_verdict(verdict({"A": ("keep", ""), "B": ("maybe", "")}, winner=""))
    with pytest.raises(VerdictError, match="drop"):
        parse_verdict(verdict({"A": ("drop", ""), "B": ("keep", "")}, winner="A"))


def test_reveal_joins_key_and_run_metrics(tmp_path):
    board = make_board(tmp_path, TWO_RUNS, {"A": ("keep", "best mouth"), "B": ("maybe", "stiff")})
    md = reveal(board)
    data = json.loads((board / "reveal.json").read_text(encoding="utf-8"))
    assert data["schema"] == "th-reveal/1" and data["winner"] == "A" and data["seed"] == 3
    a = data["letters"]["A"]
    assert (a["arm"], a["pick"], a["notes"]) == ("dub-ls", "keep", "best mouth")
    assert a["sync"] == {"conf": 9.18, "offsetFrames": 0}
    assert a["identity"] == {"mean": 0.98, "min": 0.946}
    assert (a["rtf"], a["vramPeakMiB"]) == (12.8, 20582)
    b = data["letters"]["B"]
    assert b["identity"] == {"mean": None, "min": None} and b["rtf"] is None
    text = md.read_text(encoding="utf-8")
    assert md == board / "reveal.md"
    row_b = next(ln for ln in text.splitlines() if ln.startswith("| B "))
    assert "n/a" in row_b and "baseline" in row_b and "stiff" in row_b


def test_reveal_rows_sorted_by_pick_then_sync_and_winner_marked(tmp_path):
    runs = {
        "A": {"arm": "noop", "sync": {"conf": 1.0, "offsetFrames": 0}},
        "B": {"arm": "baseline", "sync": {"conf": 5.0, "offsetFrames": 0}},
        "C": {"arm": "dub-ls", "sync": {"conf": 9.0, "offsetFrames": 0}},
        "D": {"arm": "a2f-keys", "sync": {"conf": 6.0, "offsetFrames": 0}},
        "E": {"arm": "realtime-fh", "sync": {"conf": None, "offsetFrames": None}},
    }
    picks = {"A": ("drop", ""), "B": ("keep", ""), "C": ("maybe", ""), "D": ("keep", ""), "E": ("keep", "")}
    text = reveal(make_board(tmp_path, runs, picks, winner="B")).read_text(encoding="utf-8")
    rows = [ln for ln in text.splitlines() if ln.startswith("| ") and ln[2] in "ABCDE" and ln[3] == " "]
    assert [r[2] for r in rows] == ["D", "B", "E", "C", "A"]
    assert [r for r in rows if "winner" in r] == [rows[1]]


def test_missing_or_invalid_run_json_keeps_the_row(tmp_path):
    runs = {"A": {"arm": "noop"}, "B": None, "C": "{not json"}
    picks = {"A": ("keep", ""), "B": ("maybe", "soft chin"), "C": ("drop", "")}
    md = reveal(make_board(tmp_path, runs, picks))
    data = json.loads((md.parent / "reveal.json").read_text(encoding="utf-8"))
    for x in "BC":
        row = data["letters"][x]
        assert row["sync"] == {"conf": None, "offsetFrames": None} and row["rtf"] is None
        assert "run.json" in row["note"]
    assert data["letters"]["B"]["notes"] == "soft chin"
    assert "note" not in data["letters"]["A"]
    text = md.read_text(encoding="utf-8")
    assert "soft chin" in text and text.count("run.json") >= 2


def test_pick_disagreeing_with_metrics_gets_one_line(tmp_path):
    runs = {
        "A": {"arm": "noop", "sync": {"conf": 3.0, "offsetFrames": 0},
              "identity": {"mean": 0.85, "min": 0.75, "p5": 0.8}},
        "B": {"arm": "dub-ls", "sync": {"conf": 9.0, "offsetFrames": 0}},
        "C": {"arm": "baseline", "sync": {"conf": 5.0, "offsetFrames": 0}},
    }
    picks = {"A": ("keep", ""), "B": ("drop", ""), "C": ("keep", "")}
    md = reveal(make_board(tmp_path, runs, picks, winner="C"))
    data = json.loads((md.parent / "reveal.json").read_text(encoding="utf-8"))
    assert sorted(d["letter"] for d in data["disagreements"]) == ["A", "B"]
    lines = [ln for ln in md.read_text(encoding="utf-8").splitlines() if "disagrees with metrics" in ln]
    assert len(lines) == 2 and any("A" in ln and "0.75" in ln for ln in lines)
    assert any("B" in ln and "sync" in ln for ln in lines)


# GUARD: `th board --runs ...` builds exactly as before the reveal action existed.
def test_board_build_args_unchanged():
    args = _parser().parse_args(["board", "--runs", "a,b", "--seed", "3", "--out", "o"])
    assert (args.cmd, args.runs, args.seed, str(args.out)) == ("board", "a,b", 3, "o")
    assert getattr(args, "action", "build") == "build"
    args = _parser().parse_args(["board", "--runs", "a", "--out", "o"])
    assert args.seed == 1116


def test_board_reveal_parses_and_build_still_needs_runs(tmp_path):
    args = _parser().parse_args(["board", "reveal", "--out", "o"])
    assert args.action == "reveal" and args.runs is None
    from th.cli import main

    with pytest.raises(SystemExit):
        main(["board", "--out", str(tmp_path / "o")])
