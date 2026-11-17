"""Cost per finished video-minute from a measured render: GPU-hours per video-minute, then dollars at
an hourly rate (cloud) or kWh at a measured board power plus a host allowance (local).

Cloud speed is the local 4090 time divided by an assumed speed factor (stated with the figures;
nothing here was run on a cloud GPU). Rates are public on-demand list prices, read 2026-11-17:
RunPod Secure Cloud (runpod.io/pricing) A100 80GB SXM $2.19/h, H100 80GB SXM $4.39/h; Lambda
(lambda.com/pricing) H100 SXM 1x $4.89/h.
"""

from __future__ import annotations

RATES = {  # $/GPU-hour, on demand
    "a100-80gb runpod-secure": 2.19,
    "h100-80gb runpod-secure": 4.39,
    "h100-80gb lambda": 4.89,
}
SPEEDUP = {"a100": 1.0, "h100": 2.0}  # vs the RTX 4090; assumed, not measured
HOST_W = 150.0                        # CPU, RAM, board, PSU loss on top of the GPU


def gpu_hours_per_video_minute(render_s: float, video_s: float, speedup: float = 1.0) -> float:
    return render_s / video_s * 60.0 / speedup / 3600.0


def cloud_per_video_minute(render_s: float, video_s: float, rate_per_h: float, speedup: float) -> float:
    return gpu_hours_per_video_minute(render_s, video_s, speedup) * rate_per_h


def local_kwh_per_video_minute(render_s: float, video_s: float, gpu_w: float) -> float:
    return gpu_hours_per_video_minute(render_s, video_s) * (gpu_w + HOST_W) / 1000.0


def table(render_s: float, video_s: float, gpu_w: float) -> dict[str, float]:
    out = {"local 4090 GPU-h": round(gpu_hours_per_video_minute(render_s, video_s), 3),
           "local kWh": round(local_kwh_per_video_minute(render_s, video_s, gpu_w), 3)}
    for name, rate in RATES.items():
        out[f"{name} $"] = round(cloud_per_video_minute(render_s, video_s, rate,
                                                        SPEEDUP[name.split("-")[0]]), 2)
    return out
