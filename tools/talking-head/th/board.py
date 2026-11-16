"""`th board`: a blind 3x2 grid of up to six runs. Tiles are lettered A-F in reading order; which
run sits behind which letter is a seeded shuffle written only to key.json. The soundtrack is the
first run's (as given on the command line), padded with silence to the longest run."""

from __future__ import annotations

import json
import random
from pathlib import Path

from .ffmpeg import duration_s, run_ffmpeg
from .schema import load_run

LETTERS = "ABCDEF"
TILE = 540
COLS = 3
FONTS = ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def assign(runs: list[Path], seed: int) -> dict[str, Path]:
    """Letter -> run dir, a seeded shuffle (same seed and runs, same board)."""
    order = list(runs)
    random.Random(seed).shuffle(order)
    return dict(zip(LETTERS, order))


def _font() -> str | None:
    for f in FONTS:
        if Path(f).is_file():
            return f.replace(":", r"\:")
    return None


def _label(letter: str) -> str:
    font = _font()
    spec = f"fontfile='{font}':" if font else ""
    return (f"drawtext={spec}text='{letter}':x=24:y=18:fontsize=72:fontcolor=white:"
            "box=1:boxcolor=black@0.55:boxborderw=14")


def build(runs: list[Path], seed: int, out: Path) -> Path:
    if not 1 <= len(runs) <= len(LETTERS):
        raise SystemExit(f"th board: 1-{len(LETTERS)} runs, got {len(runs)}")
    for r in runs:
        if not (r / "video.mp4").is_file():
            raise SystemExit(f"th board: {r} has no video.mp4")
    out.mkdir(parents=True, exist_ok=True)
    letters = assign(runs, seed)
    longest = max(duration_s(r / "video.mp4") for r in runs)

    inputs: list[str] = []
    chains: list[str] = []
    for i, letter in enumerate(LETTERS):
        run = letters.get(letter)
        if run is None:
            chains.append(f"color=c=0x101318:s={TILE}x{TILE}:r=30:d={longest:.3f}[v{i}]")
            continue
        k = len(inputs) // 2
        inputs += ["-i", str(run / "video.mp4")]
        chains.append(
            f"[{k}:v]scale={TILE}:{TILE}:force_original_aspect_ratio=decrease,"
            f"pad={TILE}:{TILE}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,"
            f"tpad=stop_mode=clone:stop_duration={longest:.3f},{_label(letter)}[v{i}]"
        )
    audio_k = [letters[x] for x in LETTERS if x in letters].index(runs[0])
    layout = "|".join(f"{(i % COLS) * TILE}_{(i // COLS) * TILE}" for i in range(len(LETTERS)))
    graph = ";".join(chains + [
        "".join(f"[v{i}]" for i in range(len(LETTERS))) + f"xstack=inputs={len(LETTERS)}:layout={layout}[v]",
        f"[{audio_k}:a]apad[a]",
    ])
    board = out / "board.mp4"
    run_ffmpeg([*inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-t", f"{longest:.3f}", "-movflags", "+faststart",
                str(board)])

    key = {
        "schema": "th-board/1",
        "seed": seed,
        "audioFrom": str(runs[0]),
        "durationS": round(longest, 3),
        "letters": {x: _describe(r) for x, r in letters.items()},
    }
    (out / "key.json").write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8", newline="\n")
    (out / "verdict.md").write_text(_verdict(sorted(letters), seed), encoding="utf-8", newline="\n")
    return board


def _describe(run: Path) -> dict:
    info: dict = {"run": str(run)}
    try:
        rec = load_run(run / "run.json")
        info.update(arm=rec.arm, script=rec.script, seed=rec.seed)
    except (OSError, ValueError):
        info.update(arm=None, script=None, seed=None)
    return info


def _verdict(letters: list[str], seed: int) -> str:
    lines = [
        "# Board verdict",
        "",
        f"Blind board, seed {seed}. Watch board.mp4 before opening key.json.",
        "For each tile: `pick` is one of keep / maybe / drop; notes are free text",
        "(lip sync, identity drift, artefacts, motion, would it pass as a presenter?).",
        "",
    ]
    for x in letters:
        lines += [f"## {x}", "", "- pick: ", "- notes: ", ""]
    lines += ["## Overall", "", "- winner: ", "- why: ", ""]
    return "\n".join(lines)
