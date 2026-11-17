"""TensorRT speed of LivePortrait's four networks, batch 24 (one live chunk), FP16.

    python -m th.experiments.head3d.lp_trt export     # FlashHead env: ONNX into $TH_HOME/head3d/trt/
    uv run python -m th.experiments.head3d.lp_trt time  # core env: trtexec in the round 3 container

torch.onnx needs the `onnx` package, which the FlashHead env does not have and must not gain: it is
installed on its own with `uv pip install --python <FlashHead python> --target
$TH_HOME/envs/head3d-onnx --no-deps onnx==1.17.0` (36 MB; protobuf 3.20.3 is already in the env) and
put on PYTHONPATH for the export only.
`export` writes motion_extractor (M), appearance_feature_extractor (F), warping_module (W) and
spade_generator (G) as static batch-24 ONNX (opset 20). TensorRT's GridSample takes 4D input only, and
W samples 5D volumes (trilinear, twice), so W is exported with `grid_sample_3d`: the same sampling as
F.grid_sample (bilinear, zeros padding, align_corners False) written as 8 corner gathers; `export`
prints its largest difference from the original W on the same input.
`time` runs `trtexec --fp16` for each in `th-a2f-sdk` (CUDA 12.9, TensorRT 10.13; Docker Desktop
with the nvidia runtime), one GPU lock hold per network, and reads its GPU compute time. Speed only: the engines'
outputs are not compared with PyTorch here.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from ...paths import th_home

IMAGE = "th-a2f-sdk:1ca0f02"
B = 24
NETS = ("M", "F", "W", "G")


def grid_sample_3d(inp, grid):
    """F.grid_sample(inp, grid, mode="bilinear", padding_mode="zeros", align_corners=False) for a 5D
    `inp` (N, C, D, H, W) and `grid` (N, d, h, w, 3) [x, y, z], with gathers only (ONNX GatherElements)."""
    import torch

    n, c, d, h, w = inp.shape
    out_sp = grid.shape[1:4]
    g = grid.reshape(n, -1, 3)
    ix = ((g[..., 0] + 1) * w - 1) / 2
    iy = ((g[..., 1] + 1) * h - 1) / 2
    iz = ((g[..., 2] + 1) * d - 1) / 2
    x0, y0, z0 = ix.floor(), iy.floor(), iz.floor()
    flat = inp.reshape(n, c, d * h * w)
    out = torch.zeros((n, c, g.shape[1]), dtype=inp.dtype, device=inp.device)
    for dz in (0, 1):
        zc = z0 + dz
        wz = 1 - (iz - zc).abs()
        for dy in (0, 1):
            yc = y0 + dy
            wy = 1 - (iy - yc).abs()
            for dx in (0, 1):
                xc = x0 + dx
                wx = 1 - (ix - xc).abs()
                ok = (xc >= 0) & (xc <= w - 1) & (yc >= 0) & (yc <= h - 1) & (zc >= 0) & (zc <= d - 1)
                idx = (zc.clamp(0, d - 1) * h + yc.clamp(0, h - 1)) * w + xc.clamp(0, w - 1)
                v = torch.gather(flat, 2, idx.long()[:, None, :].expand(n, c, -1))
                out = out + v * (wx * wy * wz * ok.to(inp.dtype))[:, None, :]
    return out.reshape(n, c, *out_sp)


class _FShim:
    """torch.nn.functional with grid_sample on 5D inputs replaced by grid_sample_3d."""

    def __init__(self, real):
        self._real = real

    def grid_sample(self, inp, grid, *args, **kwargs):
        if inp.dim() == 5:
            return grid_sample_3d(inp, grid)
        return self._real.grid_sample(inp, grid, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


def trt_dir() -> Path:
    d = th_home() / "head3d" / "trt"
    d.mkdir(parents=True, exist_ok=True)
    return d


def export(names: tuple[str, ...] = NETS) -> None:
    import numpy as np
    import torch

    from .lp_bridge import LPRenderer
    from .lp_run import bust512, source_landmarks

    src = bust512()
    r = LPRenderer(src, source_landmarks(src), source="frame", half=False)
    lp = r.lp
    x = r.crop256(torch.from_numpy(np.repeat(src[None], B, 0)).cuda())
    with torch.no_grad():
        info = lp.get_kp_info(x)
        f = lp.extract_feature_3d(x)
        kp = r.kp(info)
        wo = lp.warping_module(f, kp_source=kp, kp_driving=kp)["out"]

    class Warp(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, feature, kp_driving, kp_source):
            return self.m(feature, kp_driving=kp_driving, kp_source=kp_source)["out"]

    class Gen(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, feature):
            return self.m(feature=feature)

    class Motion(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            o = self.m(x)
            return o["pitch"], o["yaw"], o["roll"], o["t"], o["exp"], o["scale"], o["kp"]

    jobs = {
        "M": (Motion(lp.motion_extractor), (x,)),
        "F": (lp.appearance_feature_extractor, (x,)),
        "W": (Warp(lp.warping_module), (f, kp, kp)),
        "G": (Gen(lp.spade_generator), (wo,)),
    }
    import importlib

    import torch.nn.functional as tf

    mods = [importlib.import_module(m) for m in ("lpsrc.modules.dense_motion", "lpsrc.modules.warping_network")]
    for m in mods:
        m.F = _FShim(tf)
    with torch.no_grad():
        alt = lp.warping_module(f, kp_source=kp, kp_driving=kp)["out"]
    print(f"head3d: W with grid_sample_3d, max abs diff {float((alt - wo).abs().max()):.2e} "
          f"(output max {float(wo.abs().max()):.2f})")
    d = trt_dir()
    for name, (mod, args) in jobs.items():
        if name not in names:
            continue
        path = d / f"{name}.onnx"
        with torch.no_grad():
            torch.onnx.export(mod.eval(), args, str(path), opset_version=20, do_constant_folding=True)
        print(f"head3d: {name} -> {path} ({path.stat().st_size / 2**20:.0f} MiB)")


def time_all(names: tuple[str, ...] = NETS) -> dict:
    from ...gpu import gpu_lock

    d = trt_dir()
    old = d / "trt.json"
    out: dict = json.loads(old.read_text(encoding="utf-8")) if old.is_file() else {}
    for name in names:  # one lock hold per network (each build stays well under 20 min)
        with gpu_lock():
            argv = ["docker", "run", "--rm", "--name", f"th-h1-trt-{name}", "--gpus", "all", "-v", f"{d}:/w", IMAGE,
                    "/usr/src/tensorrt/bin/trtexec", f"--onnx=/w/{name}.onnx", "--fp16",
                    f"--saveEngine=/w/{name}.plan", "--iterations=50", "--warmUp=500", "--avgRuns=10"]
            res = subprocess.run(argv, capture_output=True, text=True, timeout=1100)
            log = res.stdout + res.stderr
            (d / f"{name}.trtexec.log").write_text(log, encoding="utf-8", newline="\n")
            m = re.search(r"GPU Compute Time: min = ([\d.]+) ms, max = ([\d.]+) ms, mean = ([\d.]+) ms, "
                          r"median = ([\d.]+) ms", log)
            out[name] = ({"meanMs": float(m.group(3)), "medianMs": float(m.group(4)), "minMs": float(m.group(1))}
                         if m else {"error": (log.strip().splitlines() or ["no output"])[-1][:300]})
            print(name, out[name], flush=True)
    ok = [out[k]["medianMs"] for k in NETS if "medianMs" in out.get(k, {})]
    out["sumMedianMs"] = round(sum(ok), 1) if len(ok) == len(NETS) else None
    (d / "trt.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8", newline="\n")
    return out


def _export_locked(names: tuple[str, ...]) -> None:
    from ...gpu import gpu_lock

    with gpu_lock():
        export(names)


if __name__ == "__main__":
    picked = tuple(sys.argv[2:]) or NETS  # e.g. `export W`
    {"export": _export_locked, "time": time_all}[sys.argv[1]](picked)
