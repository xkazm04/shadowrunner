"""Evaluate the Iris sharpener against none (bicubic) and maxine (core env, GPU lock held).

    uv run python -m th.live.upscale.iris_eval holdout --out <dir> [--arms bicubic,maxine,iris]
    uv run python -m th.live.upscale.iris_eval live --video <raw.mp4> --out <dir> [--audio <wav>]
        [--clip-start 10]

- `holdout`: the HOLDOUT edits' stored FlashHead-VAE inputs (the still bust clip and one moving clip,
  9 frames each) against the true 1024: PSNR and SSIM on the face box, Laplacian sharpness, and
  holdout-sheet.png (eyes, cheek freckles, lips at 2x zoom: truth | arms). ms per 24-frame chunk.
- `live`: ab.py's A/B on real FlashHead output (a live-bench raw.mp4 at 512) with `iris` as an arm:
  ms per chunk, VRAM, sharpness, identity, flicker, sheet.png and the 6 s side.mp4.
Maxine figures are NVIDIA-benchmark data (SLA 8.9): write them under var/ (gitignored), never docs/.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from ...gpu import gpu_lock
from . import ab
from . import iris_data as D

# 1024 bust-frame boxes (x0, y0, x1, y1), each 192 x 128, on the portrait's still framing
REGIONS = {"eyes": (290, 276, 482, 404), "freckles": (296, 392, 488, 520), "lips": (416, 548, 608, 676)}
ZOOM = 2


def make_arm(name: str):
    """ab's arms plus `iris` (the shipped weights) and `iris-<tag>` (iris-x2-<tag>.pth, a variant)."""
    if name == "iris" or name.startswith("iris-"):
        from .iris import IrisUpscaler, weights_path

        p = weights_path()
        return IrisUpscaler(p if name == "iris" else p.with_name(f"iris-x2-{name[5:]}.pth"))
    return _ab_make_arm(name)


_ab_make_arm = ab.make_arm


def holdout(out: Path, arms: list[str]) -> dict:
    import torch
    from PIL import Image

    out.mkdir(parents=True, exist_ok=True)
    paths = dict(D.sources())
    a, b, c, d = (v * 2 for v in D.FACE_BOX_512)
    rec: dict = {"holdout": list(D.HOLDOUT), "faceBox1024": [a, b, c, d], "arms": {}, "perEdit": {}}
    rows = []
    with gpu_lock():
        live = {n: make_arm(n) for n in arms}
        for arm in live.values():
            arm.warmup()
        acc = {n: {"psnr": [], "ssim": [], "sharp": [], "ms": []} for n in arms}
        truth_sharp = []
        for name in D.HOLDOUT:
            z = np.load(D.data_dir() / f"{name}.npz")
            src = torch.from_numpy(D.load_rgb(paths[name]).copy()).cuda().permute(2, 0, 1).float().div_(255)
            per = {n: {"psnr": [], "ssim": []} for n in arms}
            for clip in (0, 1):
                lr = torch.from_numpy(z["lr"][clip]).cuda()  # (9,512,512,3) uint8
                hr = D.render(src[None], torch.from_numpy(z["traj"][clip]).cuda(), bool(z["flip"][clip]))
                hr8 = hr.mul(255).round().div(255)  # the truth as an 8-bit frame
                truth = hr8[:, :, b:d, a:c]
                truth_sharp += D.lap_var(D.to_grey255(truth)).tolist()
                for n, arm in live.items():
                    y = arm(lr)[:9].permute(0, 3, 1, 2).float().div_(255)
                    yc = y[:, :, b:d, a:c]
                    ps = [D.psnr(yc[i], truth[i]) for i in range(9)]
                    ss = [D.ssim(D.to_grey255(yc[i:i + 1]) / 255, D.to_grey255(truth[i:i + 1]) / 255) for i in range(9)]
                    per[n]["psnr"] += ps
                    per[n]["ssim"] += ss
                    acc[n]["sharp"] += D.lap_var(D.to_grey255(yc)).tolist()
                    if clip == 0:
                        rows.append((name, n, y[4]))
                if clip == 0:
                    rows.append((name, "truth", hr8[4]))
            rec["perEdit"][name] = {n: {"psnr": round(float(np.mean(v["psnr"])), 3),
                                        "ssim": round(float(np.mean(v["ssim"])), 4)} for n, v in per.items()}
            for n in arms:
                acc[n]["psnr"] += per[n]["psnr"]
                acc[n]["ssim"] += per[n]["ssim"]
        chunk = torch.from_numpy(z["lr"][0]).cuda().repeat(3, 1, 1, 1)[:24]  # a full 24-frame chunk
        for n, arm in live.items():
            for k in range(12):  # 2 warm calls, then 10 timed
                torch.cuda.synchronize()
                t = time.perf_counter()
                arm(chunk)
                torch.cuda.synchronize()
                if k >= 2:
                    acc[n]["ms"].append((time.perf_counter() - t) * 1000)
        for arm in live.values():
            if hasattr(arm, "close"):
                arm.close()
    for n in arms:
        v = acc[n]
        rec["arms"][n] = {"psnr": round(float(np.mean(v["psnr"])), 3), "ssim": round(float(np.mean(v["ssim"])), 4),
                          "sharpness": round(float(np.mean(v["sharp"])), 2),
                          "chunkMs": {"p50": ab.pct(v["ms"], 50), "max": round(max(v["ms"]), 1)}}
    rec["truthSharpness"] = round(float(np.mean(truth_sharp)), 2)
    Image.fromarray(sheet(rows, ["truth", *arms])).save(out / "holdout-sheet.png")
    (out / "holdout.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8", newline="\n")
    return rec


def sheet(rows: list, cols: list[str]) -> np.ndarray:
    """Zoomed region crops: one row per (edit, region), one column per arm, truth first."""
    from PIL import Image

    imgs = {(e, n): (t.clamp(0, 1).mul(255).round().byte().permute(1, 2, 0).cpu().numpy()) for e, n, t in rows}
    lines = []
    for e in D.HOLDOUT:
        for region, (x0, y0, x1, y1) in REGIONS.items():
            cells = []
            for n in cols:
                crop = Image.fromarray(np.ascontiguousarray(imgs[(e, n)][y0:y1, x0:x1]))
                crop = np.asarray(crop.resize(((x1 - x0) * ZOOM, (y1 - y0) * ZOOM), Image.NEAREST))
                cells.append(ab.label(crop.copy(), f"{e} {region}: {ab.LABELS.get(n, n)}"))
                cells.append(np.zeros((crop.shape[0], 4, 3), np.uint8))
            lines.append(np.concatenate(cells[:-1], axis=1))
            lines.append(np.zeros((4, lines[-1].shape[1], 3), np.uint8))
    return np.concatenate(lines[:-1], axis=0)


def holdout_table(rec: dict) -> str:
    lines = ["| arm | face PSNR dB | face SSIM | sharpness (truth %s) | ms / 24-frame chunk p50 |" % rec["truthSharpness"],
             "| --- | --- | --- | --- | --- |"]
    for n, r in rec["arms"].items():
        lines.append(f"| {n} | {r['psnr']} | {r['ssim']} | {r['sharpness']} | {r['chunkMs']['p50']} |")
    lines.append("")
    lines.append("| edit | " + " | ".join(f"{n} PSNR / SSIM" for n in rec["arms"]) + " |")
    lines.append("| --- |" + " --- |" * len(rec["arms"]))
    for e, per in rec["perEdit"].items():
        lines.append(f"| {e} | " + " | ".join(f"{v['psnr']} / {v['ssim']}" for v in per.values()) + " |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m th.live.upscale.iris_eval")
    sub = p.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("holdout")
    h.add_argument("--out", type=Path, required=True)
    h.add_argument("--arms", default="bicubic,maxine,iris")
    v = sub.add_parser("live")
    v.add_argument("--video", type=Path, required=True)
    v.add_argument("--portrait", type=Path, help="default: the live bust crop")
    v.add_argument("--out", type=Path, required=True)
    v.add_argument("--arms", default="bicubic,maxine,iris")
    v.add_argument("--clip-start", type=float, default=0.0)
    v.add_argument("--audio", type=Path)
    a = p.parse_args(argv)
    if a.cmd == "holdout":
        print(holdout_table(holdout(a.out, a.arms.split(","))))
    else:
        from ..models import bust_crop

        ab.make_arm = make_arm  # ab's arms plus `iris`
        rec = ab.run(a.video, a.portrait or bust_crop(), a.out, a.arms.split(","), a.clip_start, a.audio)
        print(ab.table(rec))
    print(f"iris_eval: {a.out}")


if __name__ == "__main__":
    main()
