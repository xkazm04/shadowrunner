"""Head-rotation tracks from a Ditto run, per the round-5 track contract (H2 produces, H1 consumes).

`$TH_HOME/head3d/tracks/<name>.npz`: float32 `yaw`, `pitch`, `roll` in degrees, one value per output
frame at 25 fps, frame 0 aligned to audio sample 0; scalar `fps` = 25; string `audio` (wav path).

Values are Ditto's learned motion relative to the source portrait's own pose, in LivePortrait's
convention (the same motion extractor H1 uses): rendered pose - source pose - the constant bias
upstream's cfg adds to every frame (`overall_ctrl_info = {"delta_pitch": 2}`), so a still head reads
0 and H1 adds the track to FlashHead's own rotation. Extra keys (outside the contract, for the
record): `rendered` (N,3 yaw/pitch/roll as Ditto drew them), `source` (3,), `bias` (3,), `fit`
("exact" | "padded k" | "trimmed k").
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

FPS = 25
AXES = ("yaw", "pitch", "roll")
BIAS = np.array([0.0, 2.0, 0.0], np.float32)  # yaw, pitch, roll: upstream cfg overall_ctrl_info


def resample(x: np.ndarray, fps_in: float, fps_out: float = FPS) -> np.ndarray:
    """Linear resampling of (N, ...) samples taken at fps_in to fps_out, same start time."""
    if abs(fps_in - fps_out) < 1e-6 or len(x) < 2:
        return x.astype(np.float32)
    dur = (len(x) - 1) / fps_in
    t_out = np.arange(int(np.floor(dur * fps_out + 1e-9)) + 1) / fps_out
    t_in = np.arange(len(x)) / fps_in
    flat = x.reshape(len(x), -1)
    cols = [np.interp(t_out, t_in, flat[:, j]) for j in range(flat.shape[1])]
    return np.stack(cols, 1).reshape((len(t_out),) + x.shape[1:]).astype(np.float32)


def fit_length(x: np.ndarray, n: int) -> tuple[np.ndarray, str]:
    """Pad (repeat the last frame) or trim to exactly n frames, and say which."""
    if len(x) == n:
        return x, "exact"
    if len(x) > n:
        return x[:n], f"trimmed {len(x) - n}"
    pad = np.repeat(x[-1:], n - len(x), 0)
    return np.concatenate([x, pad], 0), f"padded {n - len(x)}"


def relative(rendered: np.ndarray, source: np.ndarray, bias: np.ndarray = BIAS) -> np.ndarray:
    """(N,3) rendered yaw/pitch/roll -> motion relative to the source pose, bias removed."""
    return (rendered - source[None, :] - bias[None, :]).astype(np.float32)


def export(pose_npz: Path, audio: Path, out: Path, n_frames: int | None = None,
           fps_in: float = FPS) -> dict:
    d = np.load(pose_npz)
    rendered, src = d["rendered"], d["source"]
    if len(rendered) == 0:
        raise SystemExit(f"ditto track: no poses in {pose_npz}")
    source = src[0] if src.ndim == 2 else src
    rel = resample(relative(rendered, source), fps_in)
    rend = resample(rendered.astype(np.float32), fps_in)
    fit = "exact"
    if n_frames is not None:
        rel, fit = fit_length(rel, n_frames)
        rend, _ = fit_length(rend, n_frames)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, yaw=rel[:, 0].copy(), pitch=rel[:, 1].copy(), roll=rel[:, 2].copy(),
             fps=np.float32(FPS), audio=np.str_(str(audio)), rendered=rend,
             source=source.astype(np.float32), bias=BIAS, fit=np.str_(fit))
    return {"track": str(out), "frames": len(rel), "fit": fit, "source": [round(float(v), 2) for v in source],
            "stats": stats(rel)}


def load(track: Path) -> dict:
    d = np.load(track)
    return {k: d[k] for k in d.files}


def stats(ypr: np.ndarray, fps: float = FPS) -> dict:
    """Per axis: SD, p5-p95 range, max-min, mean |angular speed| (deg/s); plus the combined angular
    speed (norm of the per-frame rotation-angle change) mean and p95."""
    ypr = np.asarray(ypr, np.float64)
    ok = np.isfinite(ypr).all(1)
    ypr = ypr[ok]
    if len(ypr) < 3:
        return {"frames": int(len(ypr))}
    vel = np.diff(ypr, axis=0) * fps
    out: dict = {"frames": int(len(ypr))}
    for j, ax in enumerate(AXES):
        a = ypr[:, j]
        out[ax] = {"sd": round(float(a.std()), 2),
                   "rangeP5P95": round(float(np.percentile(a, 95) - np.percentile(a, 5)), 2),
                   "maxMin": round(float(a.max() - a.min()), 2),
                   "speedMean": round(float(np.abs(vel[:, j]).mean()), 2)}
    sp = np.linalg.norm(vel, axis=1)
    out["speed"] = {"mean": round(float(sp.mean()), 2), "p95": round(float(np.percentile(sp, 95)), 2)}
    return out
