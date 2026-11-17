"""Review sheets and side-by-side clips for head3d renders (core env).

    uv run python -m th.experiments.head3d.lp_sheet --ref <FlashHead raw.mp4> <clip dir>... [--sbs <out.mp4>]
        [--mouth <out.jpg>]

Per clip dir (raw.mp4 + track.npz), at the extremes of its added track (yaw min / max, pitch min / max):
- sheet-head.jpg: FlashHead alone | the clip, head crop (x 56-456, y 0-400 of 512);
- sheet-zoom.jpg: the sides of the head at 1.5x (left: x 24-184, right: x 328-488, y 40-360), FlashHead
  alone then the clip for each side, to show what fills the cheek, ear and hair a turn reveals;
- sheet-shoulders.jpg: the shoulder band (y 380-512), FlashHead alone | the clip.
--sbs hstacks the reference and the clips (in the order given) with the reference's audio.
--mouth writes a lip sheet (x 176-336, y 262-372 at 3x) at the 4 most open-mouthed frames of the ref.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

from ...ffmpeg import read_frames
from .track_stats import load_npz

HEAD = (56, 0, 456, 400)
LEFT = (24, 40, 184, 360)
RIGHT = (328, 40, 488, 360)
SHOULDERS = (0, 380, 512, 512)
LIPS = (176, 262, 336, 372)


def extremes(track: np.ndarray) -> list[tuple[str, int]]:
    out = [("yaw min", int(np.argmin(track[:, 0]))), ("yaw max", int(np.argmax(track[:, 0]))),
           ("pitch min", int(np.argmin(track[:, 1]))), ("pitch max", int(np.argmax(track[:, 1])))]
    return out


def frames_at(raw: Path, idx: list[int]) -> dict[int, np.ndarray]:
    want, got = set(idx), {}
    for i, f in enumerate(read_frames(raw, (512, 512))):
        if i in want:
            got[i] = f.copy()
            if len(got) == len(want):
                break
    return got


def crop(f: np.ndarray, box: tuple[int, int, int, int], scale: float = 1.0) -> np.ndarray:
    x0, y0, x1, y1 = box
    c = Image.fromarray(f[y0:y1, x0:x1])
    if scale != 1.0:
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
    return np.asarray(c)


def grid(rows: list[list[np.ndarray]], gap: int = 4) -> Image.Image:
    h = max(c.shape[0] for r in rows for c in r)
    lines = []
    for r in rows:
        cells = []
        for c in r:
            cells += [c, np.full((h, gap, 3), 255, np.uint8)]
        lines += [np.concatenate(cells[:-1], 1), np.full((gap, sum(c.shape[1] for c in r) + gap * (len(r) - 1), 3),
                                                        255, np.uint8)]
    return Image.fromarray(np.concatenate(lines[:-1], 0))


def clip_sheets(ref: Path, d: Path) -> list[tuple[str, int]]:
    ex = extremes(load_npz(d / "track.npz"))
    idx = [i for _, i in ex]
    a, b = frames_at(ref, idx), frames_at(d / "raw.mp4", idx)
    grid([[crop(a[i], HEAD, 0.75), crop(b[i], HEAD, 0.75)] for i in idx]).save(d / "sheet-head.jpg", quality=92)
    grid([[crop(a[i], LEFT, 1.5), crop(b[i], LEFT, 1.5), crop(a[i], RIGHT, 1.5), crop(b[i], RIGHT, 1.5)]
          for i in idx]).save(d / "sheet-zoom.jpg", quality=92)
    grid([[crop(a[i], SHOULDERS), crop(b[i], SHOULDERS)] for i in idx]).save(d / "sheet-shoulders.jpg", quality=92)
    return ex


def mouth_sheet(ref: Path, dirs: list[Path], out: Path, n: int = 4) -> list[int]:
    """Columns: ref, then each clip; rows: the n frames where the ref's lip box is brightest-varied
    (a proxy for an open mouth with teeth: the grey SD of the lip crop), at least 1 s apart."""
    sd = []
    for f in read_frames(ref, (512, 512)):
        x0, y0, x1, y1 = LIPS
        sd.append(float(f[y0 + 30:y1 - 30, x0 + 30:x1 - 30].std()))
    order, pick = np.argsort(sd)[::-1], []
    for i in order:
        if all(abs(int(i) - j) >= 25 for j in pick):
            pick.append(int(i))
        if len(pick) == n:
            break
    pick.sort()
    cols = [frames_at(ref, pick)] + [frames_at(d / "raw.mp4", pick) for d in dirs]
    grid([[crop(c[i], LIPS, 3.0) for c in cols] for i in pick]).save(out, quality=92)
    return pick


def sbs(ref: Path, dirs: list[Path], out: Path) -> None:
    argv = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(ref)]
    for d in dirs:
        argv += ["-i", str(d / "raw.mp4")]
    k = len(dirs) + 1
    fc = "".join(f"[{i}:v]" for i in range(k)) + f"hstack=inputs={k}[v]"
    argv += ["-filter_complex", fc, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "16",
             "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", str(out)]
    subprocess.run(argv, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+", type=Path)
    ap.add_argument("--ref", type=Path, required=True)
    ap.add_argument("--sbs", type=Path, default=None)
    ap.add_argument("--mouth", type=Path, default=None)
    ap.add_argument("--no-sheets", action="store_true")
    a = ap.parse_args()
    if not a.no_sheets:
        for d in a.dirs:
            if (d / "track.npz").is_file():
                print(d.name, clip_sheets(a.ref, d))
    if a.mouth:
        print("mouth frames", mouth_sheet(a.ref, a.dirs, a.mouth))
    if a.sbs:
        sbs(a.ref, a.dirs, a.sbs)


if __name__ == "__main__":
    main()
