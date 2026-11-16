"""Matte A/B on recorded FlashHead output (512 bust crops), in the FlashHead env:

    python -m th.live.matte.bench --clip <raw.mp4> [--clip <idle raw.mp4>] --out <dir> \
        [--config "birefnet-lite-matting:res=384,guide=4,smooth=0.35" ...]

Per config and clip, under the GPU lock (co-tenants recorded): ms per 24-frame chunk p50/p95 (synced),
peak VRAM the matte allocated, and two flicker figures in the alpha edge band (0..255 scale):
- `flicker`        mean |alpha_t - alpha_t-1| over the band, motion included;
- `staticFlicker`  the same over band pixels whose colour did not change (max channel step <= 2/255),
                   so it is flicker alone: an alpha that moves while the picture stands still.
Writes bench.json and, per clip, a sheet: 3 frames per config over a checkerboard and over a bright
slide, plus 3x zooms on the hair edge and the headset edge.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

CHUNK = 24
DEFAULT_CONFIGS = [  # the shipped kinds (kinds.py) plus the unsmoothed default for contrast
    "mediapipe",
    "birefnet-lite:res=384,stride=2",
    "birefnet-lite-matting:res=384,stride=2",
    "birefnet-lite-matting:res=320,stride=2",
    "birefnet-lite-matting:res=384,stride=2,smooth=1",
    "birefnet:res=384,stride=2",
]
# the offline matte's grade (th/post/alpha.py: BiRefNet at its native 1024, no smoothing) as the
# quality reference: `refDiff` = mean |alpha - ref| over the reference's edge band
REFERENCE = "birefnet:res=1024,guide=0,smooth=1,batch=2"  # small batch: 24 at 1024 fills 24 GB
# zoom boxes on the 512 bust crop (x0, y0, x1, y1): left hair edge, right headset + mic edge
ZOOMS = {"hair": (16, 160, 112, 256), "headset": (396, 120, 492, 216)}


def parse_config(spec: str) -> tuple[str, dict]:
    kind, _, rest = spec.partition(":")
    kw: dict = {}
    for item in filter(None, rest.split(",")):
        k, _, v = item.partition("=")
        key = {"guide": "guide_r"}.get(k, k)
        kw[key] = float(v) if "." in v else int(v)
    if "smooth" in kw:
        kw["smooth"] = float(kw["smooth"])
    return kind, kw


def build(spec: str):
    kind, kw = parse_config(spec)
    if kind == "mediapipe":
        from .selfie import SelfieMatte

        return SelfieMatte(**kw)
    from .birefnet import BiRefNetMatte

    return BiRefNetMatte(kind, **kw)


def load_clip(path: Path, max_frames: int) -> np.ndarray:
    from ...ffmpeg import read_frames

    frames = [f.copy() for f in read_frames(path, (512, 512), max_frames=max_frames)]
    n = len(frames) // CHUNK * CHUNK
    return np.stack(frames[:n])


def edge_band(alpha: np.ndarray) -> np.ndarray:
    """Pixels in the soft edge or within 3 px of the hard edge (bool, same shape)."""
    import torch
    from torch.nn import functional as F

    a = torch.from_numpy(alpha).float().unsqueeze(1)
    soft = (a > 12) & (a < 243)
    hard = a > 127
    grow = F.max_pool2d(hard.float(), 7, 1, 3) - (-F.max_pool2d(-hard.float(), 7, 1, 3))
    band = soft | (grow > 0)
    return F.max_pool2d(band.float(), 3, 1, 1).squeeze(1).bool().numpy()


def flicker(alpha: np.ndarray, frames: np.ndarray) -> dict:
    band = edge_band(alpha)
    a = alpha.astype(np.int16)
    step = np.abs(a[1:] - a[:-1]).astype(np.float32)
    both = band[1:] | band[:-1]
    still = np.abs(frames[1:].astype(np.int16) - frames[:-1].astype(np.int16)).max(-1) <= 2
    static = both & still
    return {"flicker": round(float(step[both].mean()), 3),
            "staticFlicker": round(float(step[static].mean()), 3) if static.any() else None,
            "bandPx": int(both.sum() // max(1, len(step))),
            "staticBandPx": int(static.sum() // max(1, len(step)))}


def ref_diff(alpha: np.ndarray, ref: np.ndarray, band: np.ndarray) -> dict:
    d = np.abs(alpha.astype(np.int16) - ref.astype(np.int16))[band]
    return {"refDiff": round(float(d.mean()), 2), "refBadPct": round(float((d > 64).mean() * 100), 2)}


def run_config(spec: str, clip: np.ndarray) -> tuple[dict, np.ndarray]:
    import torch

    matte = build(spec)
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    base = torch.cuda.memory_allocated()
    t0 = time.perf_counter()
    matte.warmup()
    warm_ms = (time.perf_counter() - t0) * 1000
    gpu = torch.from_numpy(clip).cuda()
    ms, out = [], []
    for i in range(0, len(clip), CHUNK):
        chunk = gpu[i:i + CHUNK]
        torch.cuda.synchronize()
        t = time.perf_counter()
        alpha = matte(chunk)
        torch.cuda.synchronize()
        ms.append((time.perf_counter() - t) * 1000)
        assert alpha.shape == chunk.shape[:3] and alpha.dtype == torch.uint8 and alpha.is_cuda
        out.append(alpha.cpu().numpy())
    peak = (torch.cuda.max_memory_allocated() - base - gpu.numel()) / 2**20
    del matte, gpu
    torch.cuda.empty_cache()
    alpha = np.concatenate(out)
    row = {"config": spec, "chunks": len(ms), "msP50": round(float(np.percentile(ms, 50)), 1),
           "msP95": round(float(np.percentile(ms, 95)), 1), "msMax": round(max(ms), 1),
           "warmupMs": round(warm_ms), "vramPeakMiB": round(peak),
           **flicker(alpha, clip)}
    return row, alpha


# -- sheets ----------------------------------------------------------------------------------
def checker(h: int, w: int, cell: int = 16) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // cell + xx // cell) % 2).astype(np.float32)
    return np.repeat((150 + 70 * c)[..., None], 3, -1)


def slide(h: int, w: int) -> np.ndarray:
    """A bright slide: near-white with a pale blue title bar and grey text-like bars."""
    bg = np.full((h, w, 3), (246, 247, 250), np.float32)
    bg[: h // 7] = (214, 228, 250)
    for k in range(6):
        y = h // 4 + k * h // 10
        bg[y:y + h // 40, w // 12: w // 12 + (w * (5 + k % 3)) // 10] = (170, 176, 186)
    return bg


def comp(rgb: np.ndarray, alpha: np.ndarray, bg: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255
    return (rgb.astype(np.float32) * a + bg * (1 - a)).clip(0, 255).astype(np.uint8)


def sheet(path: Path, clip: np.ndarray, alphas: dict[str, np.ndarray], f: int) -> None:
    """One frame, one row per config: checker | slide | hair zoom (checker, slide) | headset zoom."""
    from PIL import Image, ImageDraw

    tile = 256
    img = Image.new("RGB", (180 + 6 * tile, 24 + (tile + 4) * (len(alphas) + 1)), (32, 32, 36))
    draw = ImageDraw.Draw(img)
    draw.text((184, 6), f"frame {f}: checker | slide | hair edge x2.7 (checker, slide) | headset edge "
              "x2.7 (checker, slide)", fill=(200, 200, 200))
    cb, sl = checker(512, 512), slide(512, 512)
    rgb = clip[f]
    rows = [("source", np.full(rgb.shape[:2], 255, np.uint8))]
    rows += [(name, alpha[f]) for name, alpha in alphas.items()]
    for r, (name, a) in enumerate(rows):
        y = 24 + r * (tile + 4)
        draw.text((6, y + 4), name.replace(":", "\n").replace(",", "\n"), fill=(230, 230, 230))
        pics = [comp(rgb, a, cb), comp(rgb, a, sl)]
        tiles = [Image.fromarray(p).resize((tile, tile), Image.LANCZOS) for p in pics]
        for key in ("hair", "headset"):
            x0, y0, x1, y1 = ZOOMS[key]
            tiles += [Image.fromarray(p[y0:y1, x0:x1]).resize((tile, tile), Image.LANCZOS) for p in pics]
        for i, t in enumerate(tiles):
            img.paste(t, (180 + i * tile, y))
    img.save(path)


def timing(configs: list[str], clip: np.ndarray, rounds: int) -> list[dict]:
    """ms per chunk with the configs interleaved chunk by chunk, so a co-tenant whose load comes
    and goes weighs on every config alike (sequential runs drift with it)."""
    import torch

    mattes = {spec: build(spec) for spec in configs}
    for m in mattes.values():
        m.warmup()
    gpu = torch.from_numpy(clip).cuda()
    ms: dict[str, list[float]] = {spec: [] for spec in configs}
    for _ in range(rounds):
        for i in range(0, len(clip), CHUNK):
            for spec, m in mattes.items():
                torch.cuda.synchronize()
                t = time.perf_counter()
                m(gpu[i:i + CHUNK])
                torch.cuda.synchronize()
                ms[spec].append((time.perf_counter() - t) * 1000)
    return [{"config": spec, "chunks": len(v), "msP50": round(float(np.percentile(v, 50)), 1),
             "msP95": round(float(np.percentile(v, 95)), 1)} for spec, v in ms.items()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m th.live.matte.bench")
    ap.add_argument("--clip", action="append", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--config", action="append")
    ap.add_argument("--frames", type=int, default=480)
    ap.add_argument("--ref", default=REFERENCE, help="reference config ('' for none)")
    ap.add_argument("--timing", type=int, default=0, metavar="ROUNDS",
                    help="interleaved timing only (first clip, ROUNDS passes), no quality figures")
    ap.add_argument("--no-lock", action="store_true", help="skip the GPU lock (tests only)")
    args = ap.parse_args(argv)
    from contextlib import nullcontext

    from ...gpu import gpu_lock, memory_used_mib, others_over_limit

    configs = args.config or DEFAULT_CONFIGS
    args.out.mkdir(parents=True, exist_ok=True)
    report: dict = {"configs": configs, "clips": {}}
    with nullcontext() if args.no_lock else gpu_lock():
        report["coTenantStart"] = others_over_limit()
        report["usedMiBStart"] = memory_used_mib()
        if args.timing:
            report["timing"] = timing(configs, load_clip(args.clip[0], args.frames), args.timing)
            for row in report["timing"]:
                print(json.dumps(row), flush=True)
        for clip_path in [] if args.timing else args.clip:
            clip = load_clip(clip_path, args.frames)
            rows, alphas = [], {}
            ref = band = None
            if args.ref:
                ref_row, ref = run_config(args.ref, clip)
                band = edge_band(ref)
                print(json.dumps({"reference": ref_row}), flush=True)
                report.setdefault("reference", {})[clip_path.parent.name] = ref_row
            for spec in configs:
                row, alphas[spec] = run_config(spec, clip)
                if ref is not None:
                    row.update(ref_diff(alphas[spec], ref, band))
                rows.append(row)
                print(json.dumps(row), flush=True)
            name = clip_path.parent.name
            for f in (len(clip) // 6, len(clip) // 2, len(clip) * 5 // 6):
                shown = alphas if ref is None else {f"ref {args.ref}": ref, **alphas}
                sheet(args.out / f"sheet-{name}-f{f:04d}.png", clip, shown, f)
            report["clips"][name] = {"path": str(clip_path), "frames": len(clip), "rows": rows}
        report["coTenantEnd"] = others_over_limit()
        report["usedMiBEnd"] = memory_used_mib()
    (args.out / "bench.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8",
                                         newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
