"""Upscaler A/B on a 512 FlashHead clip (raw.mp4): speed, VRAM, sharpness, identity and flicker.

    uv run python -m th.live.upscale.ab --video <raw.mp4> --portrait <png> --out <dir>
        [--arms bicubic,realesrgan,maxine] [--clip-start 0] [--audio <wav>]

Every arm sees the same frames, already on the GPU (as live frames are), in 24-frame chunks under the
GPU lock. `bicubic` is the reference: `none` shown at 1024 the way a browser would scale it.
- ms per chunk: wall time of one 24-frame call, synchronised; p50/p95 over the clip's chunks.
- VRAM: nvidia-smi memory.used peak minus the value before the arm loaded (each arm alone, on a
  warm CUDA context), plus torch's own peak allocation.
- face crop: the median MediaPipe face box of the 512 source, x2; identical for every arm.
- sharpness: variance of the Laplacian of the grey face crop, mean over frames.
- identity: DINOv2 cosine of every 25th frame's face crop vs the portrait (as th.post.metrics).
- flicker: mean |grey(t) - grey(t-1)| on the face crop; head motion is common to all arms, so the
  excess over bicubic is the upscaler's own temporal noise.
Writes ab.json, sheet.png (face crops at 25/50/75% of the clip, one column per arm) and side.mp4
(6 s of face crops side by side, with the audio when --audio is given).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import torch

from ...ffmpeg import FrameWriter, read_frames
from ...gpu import VramSampler, gpu_lock, memory_used_mib, others_over_limit
from ...post.face import FaceTracker, square_crop
from ...post.identity import CROP, MARGIN, Embedder, summarise
from ...post.metrics import portrait_crop

CHUNK = 24
FPS = 25
SRC = 512
LABELS = {"bicubic": "none (bicubic)", "realesrgan": "realesrgan x4v3", "realesrgan-xsx2": "realesrgan xsx2",
          "maxine": "maxine HB-high", "maxine-high": "maxine high"}


def make_arm(name: str):
    import torch
    from torch.nn import functional as F

    if name == "bicubic":
        class Bicubic:
            kind, scale = "bicubic", 2

            def warmup(self) -> None:
                return None

            def __call__(self, frames: "torch.Tensor") -> "torch.Tensor":
                x = frames.permute(0, 3, 1, 2).float()
                y = F.interpolate(x, scale_factor=2, mode="bicubic", align_corners=False)
                return y.clamp_(0, 255).round_().to(torch.uint8).permute(0, 2, 3, 1).contiguous()
        return Bicubic()
    if name.startswith("realesrgan"):
        from .realesrgan import RealEsrganUpscaler

        return RealEsrganUpscaler("xsx2" if name.endswith("xsx2") else "x4v3")
    if name.startswith("maxine"):
        from .maxine import MaxineUpscaler

        return MaxineUpscaler("HIGH" if name == "maxine-high" else "HIGHBITRATE_HIGH")
    raise ValueError(f"unknown arm {name!r}")


def co_tenants() -> list[dict]:
    """Other processes holding > 500 MiB of VRAM, with their image names when tasklist knows them."""
    rows = others_over_limit() or []
    names: dict[int, str] = {}
    if rows and sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) > 1 and parts[1].isdigit():
                names[int(parts[1])] = parts[0]
    util = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                          capture_output=True, text=True).stdout.strip()
    return [{"pid": p, "name": names.get(p), "mib": m, "gpuUtilPct": util} for p, m in rows]


def load_clip(video: Path) -> np.ndarray:
    frames = list(read_frames(video, (SRC, SRC), fps=FPS))
    if not frames:
        raise SystemExit(f"ab: no frames in {video}")
    return np.stack(frames)


def face_boxes(frames: np.ndarray) -> list[tuple[float, float, float, float] | None]:
    with FaceTracker() as tracker:
        out = []
        for f in frames:
            face = tracker.detect(f)
            out.append(face.box if face else None)
    return out


def vram_of(name: str, sample: "np.ndarray") -> dict:
    """Load one arm alone and run three chunks; peak memory.used delta and torch's peak."""
    import torch

    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    x = torch.from_numpy(sample).cuda()
    torch.cuda.synchronize()
    with VramSampler(0.05) as s:
        arm = make_arm(name)
        arm.warmup()
        for _ in range(3):
            arm(x)
        torch.cuda.synchronize()
        time.sleep(0.2)
    alloc = torch.cuda.max_memory_allocated() // 2**20
    if hasattr(arm, "close"):
        arm.close()
    del arm, x
    torch.cuda.empty_cache()
    return {"smiPeakDeltaMiB": s.peak_delta_mib, "torchPeakAllocMiB": int(alloc)}


class Stats:
    """Per-arm running metrics over the face crop (GPU)."""

    def __init__(self, box: tuple[int, int, int, int]) -> None:
        import torch

        self.torch = torch
        self.box = box
        self.lap = torch.tensor([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=torch.float32,
                                device="cuda").view(1, 1, 3, 3)
        self.sharp: list[float] = []
        self.diffs: list[float] = []
        self.prev = None
        self.ms: list[float] = []

    def add(self, out: "torch.Tensor") -> None:
        from torch.nn import functional as F

        x0, y0, x1, y1 = self.box
        crop = out[:, y0:y1, x0:x1].float()
        grey = (crop[..., 0] * 0.299 + crop[..., 1] * 0.587 + crop[..., 2] * 0.114).unsqueeze(1)
        lap = F.conv2d(grey, self.lap)
        self.sharp += lap.flatten(1).var(dim=1).tolist()
        seq = grey if self.prev is None else self.torch.cat([self.prev, grey])
        self.diffs += (seq[1:] - seq[:-1]).abs().flatten(1).mean(dim=1).tolist()
        self.prev = grey[-1:]


def pct(v: list[float], q: float) -> float:
    return round(float(np.percentile(v, q)), 1)


def label(img: np.ndarray, text: str) -> np.ndarray:
    from PIL import Image, ImageDraw

    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 + 7 * len(text), 18), fill=(0, 0, 0))
    d.text((4, 3), text, fill=(255, 255, 255))
    return np.asarray(im)


def run(video: Path, portrait: Path, out: Path, arms: list[str], clip_start: float,
        audio: Path | None) -> dict:
    import torch

    out.mkdir(parents=True, exist_ok=True)
    frames = load_clip(video)
    boxes = face_boxes(frames)
    found = [b for b in boxes if b is not None]
    if not found:
        raise SystemExit("ab: MediaPipe found no face in the clip")
    med = np.median(np.array(found), 0) * 2
    face = tuple(int(round(v)) for v in med)  # x0, y0, x1, y1 at 1024
    cx, cy = (face[0] + face[2]) / 2, (face[1] + face[3]) / 2
    half = int(max(face[2] - face[0], face[3] - face[1]) * 0.65)
    view = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))  # sheet / clip crop
    view = (max(0, view[0]), max(0, view[1]), min(SRC * 2, view[2]), min(SRC * 2, view[3]))
    view = (view[0], view[1], view[2] - (view[2] - view[0]) % 2, view[3] - (view[3] - view[1]) % 2)  # yuv420p
    n = len(frames)
    sheet_at = [int(n * q) for q in (0.25, 0.5, 0.75)]
    c0 = int(clip_start * FPS)
    clip_range = range(c0, min(n, c0 + 6 * FPS))

    record: dict = {"video": str(video), "portrait": str(portrait), "frames": n, "chunk": CHUNK,
                    "faceBox1024": list(face), "gpu": torch.cuda.get_device_name(0), "arms": {}}
    with gpu_lock():
        record["coTenantsStart"] = co_tenants()
        torch.zeros(1, device="cuda")  # CUDA context before any VRAM baseline
        for a in arms:
            record["arms"][a] = {"vram": vram_of(a, frames[:CHUNK])}
        live = {a: make_arm(a) for a in arms}
        for arm in live.values():
            arm.warmup()
        stats = {a: Stats(face) for a in arms}
        id_crops: dict[str, list[np.ndarray]] = {a: [] for a in arms}
        sheet: dict[str, list[np.ndarray]] = {a: [] for a in arms}
        vx0, vy0, vx1, vy1 = view
        side_size = ((vx1 - vx0) * len(arms), vy1 - vy0)
        argv = []
        if audio:
            argv = ["-ss", f"{clip_start:.3f}", "-t", "6", "-i", str(audio)]
        codec = ["-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p"]
        if audio:
            codec += ["-c:a", "aac", "-af", "apad", "-shortest"]  # audio may end before the video
        with FrameWriter(out / "side.mp4", side_size, FPS, "rgb24", codec, argv) as writer:
            for i in range(0, n, CHUNK):
                src = torch.from_numpy(frames[i:i + CHUNK]).cuda()
                outs = {}
                for a, arm in live.items():
                    torch.cuda.synchronize()
                    t = time.perf_counter()
                    y = arm(src)
                    torch.cuda.synchronize()
                    if len(src) == CHUNK:
                        stats[a].ms.append((time.perf_counter() - t) * 1000)
                    stats[a].add(y)
                    outs[a] = y
                for j in range(len(src)):
                    k = i + j
                    need_id = k % FPS == 0 and boxes[k] is not None
                    if not (need_id or k in sheet_at or k in clip_range):
                        continue
                    host = {a: outs[a][j].cpu().numpy() for a in arms}
                    for a in arms:
                        if need_id:
                            b = tuple(v * 2 for v in boxes[k])
                            id_crops[a].append(square_crop(host[a], b, MARGIN, CROP))
                        if k in sheet_at:
                            sheet[a].append(host[a][vy0:vy1, vx0:vx1])
                    if k in clip_range:
                        panels = [label(host[a][vy0:vy1, vx0:vx1].copy(), LABELS.get(a, a)) for a in arms]
                        try:
                            writer.write(np.concatenate(panels, axis=1))
                        except BrokenPipeError:
                            err = writer.proc.stderr.read().decode("utf-8", "replace")
                            raise RuntimeError(f"ab: side.mp4 encode failed ({writer.proc.wait()}): {err} {writer.argv}") from None
        record["coTenantsEnd"] = co_tenants()
        for arm in live.values():
            if hasattr(arm, "close"):
                arm.close()
        del live
        torch.cuda.empty_cache()
        with FaceTracker() as tracker:
            ref = portrait_crop(tracker, portrait, (SRC * 2, SRC * 2))
        emb = Embedder("cuda")
        try:
            for a in arms:
                vecs = emb.embed([ref, *id_crops[a]])
                record["arms"][a]["identity"] = summarise(vecs[1:] @ vecs[0])
        finally:
            emb.close()

    base_flicker = float(np.mean(stats[arms[0]].diffs))
    for a in arms:
        s = stats[a]
        fl = float(np.mean(s.diffs))
        record["arms"][a].update({
            "chunkMs": {"p50": pct(s.ms, 50), "p95": pct(s.ms, 95), "max": round(max(s.ms), 1),
                        "n": len(s.ms)} if s.ms else None,
            "sharpness": round(float(np.mean(s.sharp)), 2),
            "flicker": round(fl, 4),
            "flickerVsFirst": round(fl / base_flicker, 3) if base_flicker else None,
        })
    rows = [np.concatenate([sheet[a][r] for a in arms], axis=1) for r in range(len(sheet_at))]
    header = np.concatenate([label(np.zeros((20, vx1 - vx0, 3), np.uint8), LABELS.get(a, a)) for a in arms], axis=1)
    from PIL import Image

    Image.fromarray(np.concatenate([header, *rows], axis=0)).save(out / "sheet.png")
    record["sheetFrames"] = sheet_at
    record["clip"] = {"startS": clip_start, "frames": len(clip_range)}
    (out / "ab.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    return record


def table(rec: dict) -> str:
    lines = ["| arm | chunk ms p50 / p95 | VRAM smi / torch MiB | sharpness | identity mean / p5 | flicker (x first) |",
             "| --- | --- | --- | --- | --- | --- |"]
    for a, r in rec["arms"].items():
        ms = r["chunkMs"]
        lines.append(f"| {a} | {ms['p50']} / {ms['p95']} | {r['vram']['smiPeakDeltaMiB']} / "
                     f"{r['vram']['torchPeakAllocMiB']} | {r['sharpness']} | {r['identity']['mean']} / "
                     f"{r['identity']['p5']} | {r['flicker']} ({r['flickerVsFirst']}) |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m th.live.upscale.ab")
    p.add_argument("--video", type=Path, required=True)
    p.add_argument("--portrait", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--arms", default="bicubic,realesrgan,maxine")
    p.add_argument("--clip-start", type=float, default=0.0)
    p.add_argument("--audio", type=Path)
    a = p.parse_args(argv)
    rec = run(a.video, a.portrait, a.out, a.arms.split(","), a.clip_start, a.audio)
    print(table(rec))
    print(f"ab: {a.out}")


if __name__ == "__main__":
    main()
