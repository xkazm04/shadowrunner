"""`th board reveal`: read the filled blind verdict.md back, check it against key.json, join each
letter with its run.json metrics and write reveal.json (`th-reveal/1`) and reveal.md. Blindness
holds: reveal refuses until every pick and the winner are filled; on any error nothing is written."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .board import PICKS
from .schema import load_run

SCHEMA = "th-reveal/1"
IDENTITY_FLOOR = 0.8  # a 'keep' below this identity.min disagrees with the metrics

_HEADING = re.compile(r"^##\s+(.+?)\s*$")
_FIELD = re.compile(r"^-\s*(\w+):[ \t]*(.*?)\s*$")


class VerdictError(ValueError):
    """The verdict cannot be revealed yet (or is inconsistent with key.json)."""


@dataclass(frozen=True)
class Verdict:
    picks: dict[str, dict[str, str]]  # letter -> {pick, notes}
    winner: str
    why: str


def parse_verdict(text: str) -> Verdict:
    sections: dict[str, dict[str, str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if m := _HEADING.match(line):
            name = m.group(1)
            current = name if name == "Overall" or re.fullmatch(r"[A-Z]", name) else None
            if current is not None:
                sections.setdefault(current, {})
        elif current is not None and (m := _FIELD.match(line)):
            sections[current][m.group(1).lower()] = m.group(2)
    overall = sections.pop("Overall", {})
    allowed = "/".join(PICKS)
    picks: dict[str, dict[str, str]] = {}
    for x in sorted(sections):
        pick = sections[x].get("pick", "").strip().lower()
        if pick not in PICKS:
            got = f"'{pick}'" if pick else "blank"
            raise VerdictError(f"verdict {x}: pick is {got}; fill one of {allowed}")
        picks[x] = {"pick": pick, "notes": sections[x].get("notes", "")}
    if not picks:
        raise VerdictError("verdict has no letter sections")
    winner = overall.get("winner", "").strip().upper()
    if winner not in picks:
        raise VerdictError(f"verdict winner '{winner}' is not one of the letters {', '.join(picks)}")
    if picks[winner]["pick"] == "drop":
        raise VerdictError(f"verdict winner {winner} is picked 'drop'")
    return Verdict(picks, winner, overall.get("why", ""))


def _metrics(run: Path) -> tuple[dict, str | None]:
    blank = {"arm": None, "sync": {"conf": None, "offsetFrames": None},
             "identity": {"mean": None, "min": None}, "rtf": None, "vramPeakMiB": None}
    path = run / "run.json"
    try:
        rec = load_run(path)
    except OSError:
        return blank, f"no run.json at {path}"
    except ValueError as e:  # bad JSON or schema
        return blank, f"invalid run.json at {path}: {str(e).splitlines()[0]}"
    return {"arm": rec.arm, "sync": {"conf": rec.sync.conf, "offsetFrames": rec.sync.offsetFrames},
            "identity": {"mean": rec.identity.mean, "min": rec.identity.min},
            "rtf": rec.rtf, "vramPeakMiB": rec.vramPeakMiB}, None


def _disagreements(rows: dict[str, dict]) -> list[dict[str, str]]:
    confs = [r["sync"]["conf"] for r in rows.values() if r["sync"]["conf"] is not None]
    best = max(confs) if confs else None
    out: list[dict[str, str]] = []
    for x, r in rows.items():
        low = r["identity"]["min"]
        if r["pick"] == "keep" and low is not None and low < IDENTITY_FLOOR:
            out.append({"letter": x, "reason": f"keep, but identity min {low:g} < {IDENTITY_FLOOR:g}"})
        elif r["pick"] == "drop" and best is not None and r["sync"]["conf"] == best:
            out.append({"letter": x, "reason": f"drop, but the best sync conf on the board ({best:g})"})
    return out


def _sort_key(item: tuple[str, dict]) -> tuple:
    x, r = item
    conf = r["sync"]["conf"]
    return (PICKS.index(r["pick"]), conf is None, -(conf or 0.0), x)


def _na(v: object, fmt: str = "g") -> str:
    return "n/a" if v is None else format(v, fmt)


def _markdown(board: Path, data: dict) -> str:
    lines = [
        "# Board reveal",
        "",
        f"Board `{board}`, seed {data['seed']}. Winner: {data['winner']}"
        + (f" ({data['why']})" if data["why"] else "") + ".",
        "",
        "| letter | arm | pick | SyncNet conf (offset) | identity mean / min | rtf | VRAM peak MiB | notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for x, r in sorted(data["letters"].items(), key=_sort_key):
        mark = " (winner)" if x == data["winner"] else ""
        sync = f"{_na(r['sync']['conf'])} ({_na(r['sync']['offsetFrames'], 'd')})"
        ident = f"{_na(r['identity']['mean'], '.3f')} / {_na(r['identity']['min'], '.3f')}"
        notes = " ".join(filter(None, [r["notes"], r.get("note")])).replace("|", "\\|")
        lines.append(f"| {x}{mark} | {r['arm'] or 'n/a'} | {r['pick']} | {sync} | {ident} | "
                     f"{_na(r['rtf'])} | {_na(r['vramPeakMiB'], 'd')} | {notes} |")
    if data["disagreements"]:
        lines += ["", "## Picks that disagree with the metrics", ""]
        lines += [f"- {d['letter']} disagrees with metrics: {d['reason']}" for d in data["disagreements"]]
    return "\n".join(lines) + "\n"


def reveal(board: Path) -> Path:
    """Write reveal.json and reveal.md into the board dir; returns reveal.md."""
    try:
        key = json.loads((board / "key.json").read_text(encoding="utf-8"))
        text = (board / "verdict.md").read_text(encoding="utf-8")
    except (OSError, ValueError) as e:
        raise VerdictError(f"{board} is not a readable board dir: {e}") from None
    keyed = key.get("letters") if isinstance(key, dict) else None
    if not isinstance(keyed, dict):
        raise VerdictError(f"{board / 'key.json'} has no letters")
    v = parse_verdict(text)
    missing, extra = sorted(set(keyed) - set(v.picks)), sorted(set(v.picks) - set(keyed))
    if missing or extra:
        parts = ([f"missing {', '.join(missing)}"] if missing else []) + \
                ([f"extra {', '.join(extra)}"] if extra else [])
        raise VerdictError(f"verdict letters do not match key.json: {'; '.join(parts)}")

    rows: dict[str, dict] = {}
    for x in sorted(keyed):
        info = keyed[x] if isinstance(keyed[x], dict) else {}
        metrics, note = _metrics(Path(str(info.get("run", ""))))
        row = {"run": info.get("run"), **metrics, **v.picks[x]}
        row["arm"] = row["arm"] or info.get("arm")
        if note:
            row["note"] = note
        rows[x] = row
    data = {"schema": SCHEMA, "seed": key.get("seed"), "winner": v.winner, "why": v.why,
            "letters": rows, "disagreements": _disagreements(rows)}
    (board / "reveal.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    md = board / "reveal.md"
    md.write_text(_markdown(board, data), encoding="utf-8", newline="\n")
    return md
