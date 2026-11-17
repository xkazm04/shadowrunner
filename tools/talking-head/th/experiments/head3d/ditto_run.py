"""Ditto runner, executed by $TH_HOME/envs/head3d-ditto's python with cwd = the Ditto clone (round 5, H2).

    python ditto_run.py --data-root D --cfg C --task T --audio A --source S --out O
                        [--mode offline|online] [--paced] [--seed N]

Writes into O: raw.mp4 (Ditto's frames at the source size, 25 fps, the audio muxed), pose.npz
(per output frame: rendered and source yaw/pitch/roll in degrees, keypoint translation, frame wall
times) and timing.json (model load, avatar registration, time to first frame, real-time factor,
torch peak VRAM). `online` is Ditto's streaming pipeline (HuBERT streaming features, chunks of 5
frames with 3 past + 2 future); `--paced` feeds each chunk no earlier than its audio would exist in a
live call, so the first-frame time is what a listener waits. The InsightFace steps are replaced and
the Cython blend is skipped by ditto_shims.install (see there).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import random
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _seed(n: int) -> None:
    import numpy as np
    import torch

    random.seed(n)
    np.random.seed(n)
    torch.manual_seed(n)
    torch.cuda.manual_seed_all(n)


class _Timed:
    """Wraps upstream's writer: records the wall time of every frame it writes."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.times: list[float] = []

    def __call__(self, img, fmt="bgr"):
        self.times.append(time.perf_counter())
        self.inner(img, fmt=fmt)

    def close(self) -> None:
        self.inner.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    for a in ("--data-root", "--cfg", "--task", "--audio", "--source", "--out"):
        ap.add_argument(a, required=True)
    ap.add_argument("--mode", choices=("offline", "online"), default="offline")
    ap.add_argument("--paced", action="store_true")
    ap.add_argument("--seed", type=int, default=1117)
    args = ap.parse_args()

    sys.path.insert(0, os.getcwd())
    sys.path.insert(0, str(HERE))
    import ditto_shims

    ditto_shims.install(args.task)
    import librosa
    import numpy as np
    import torch

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cfg = pickle.load(open(args.cfg, "rb"))
    cfg["base_cfg"]["landmark478_cfg"]["task_path"] = args.task
    cfg_path = out / "cfg.pkl"
    pickle.dump(cfg, open(cfg_path, "wb"))
    online = args.mode == "online"
    if online:
        from stream_pipeline_online import StreamSDK
    else:
        from stream_pipeline_offline import StreamSDK

    _seed(args.seed)
    t0 = time.perf_counter()
    sdk = StreamSDK(str(cfg_path), args.data_root)
    t_load = time.perf_counter()
    # online: the settings of upstream's TensorRT online cfg (overlap 70, 10 DDIM steps)
    setup_kw = {"online_mode": True, "overlap_v2": 70, "sampling_timesteps": 10} if online else {}
    raw_tmp = out / "ditto.mp4"
    sdk.setup(args.source, str(raw_tmp), **setup_kw)
    t_setup = time.perf_counter()
    timed = _Timed(sdk.writer)
    sdk.writer = timed

    audio, _ = librosa.core.load(args.audio, sr=16000)
    n_frames = math.ceil(len(audio) / 16000 * 25)
    sdk.setup_Nd(N_d=n_frames, fade_in=-1, fade_out=-1, ctrl_info={})
    t_feed = time.perf_counter()
    if online:
        chunk = (3, 5, 2)
        padded = np.concatenate([np.zeros((chunk[0] * 640,), np.float32), audio], 0)
        split_len = int(sum(chunk) * 0.04 * 16000) + 80
        for i in range(0, len(padded), chunk[1] * 640):
            piece = padded[i:i + split_len]
            if args.paced:  # the chunk's last real sample exists at this time in a live call
                due = t_feed + max(0, min(i + split_len, len(padded)) - chunk[0] * 640) / 16000
                time.sleep(max(0.0, due - time.perf_counter()))
            if len(piece) < split_len:
                piece = np.pad(piece, (0, split_len - len(piece)), mode="constant")
            sdk.run_chunk(piece, chunk)
    else:
        sdk.audio2motion_queue.put(sdk.wav2feat.wav2feat(audio))
    sdk.close()
    t_end = time.perf_counter()

    final = out / "raw.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(sdk.tmp_output_path), "-i", args.audio,
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", str(final)], check=True)
    rec = ditto_shims.RECORDER
    times = np.array(timed.times) - t_feed
    np.savez(out / "pose.npz", rendered=np.array(rec.rendered, np.float32),
             source=np.array(rec.source, np.float32), t=np.array(rec.t, np.float32),
             frameS=times.astype(np.float32))
    dur = len(audio) / 16000
    timing = {
        "mode": args.mode, "paced": args.paced, "seed": args.seed, "audio": args.audio,
        "audioS": round(dur, 3), "framesExpected": n_frames, "framesWritten": len(timed.times),
        "posesRecorded": len(rec.rendered), "loadS": round(t_load - t0, 2),
        "registerS": round(t_setup - t_load, 2),
        "firstFrameMs": round(times[0] * 1000) if len(times) else None,
        "generateS": round(t_end - t_feed, 2), "rtf": round((t_end - t_feed) / dur, 3),
        "fpsSustained": round((len(times) - 1) / (times[-1] - times[0]), 2) if len(times) > 1 else None,
        "torchPeakMiB": round(torch.cuda.max_memory_allocated() / 2**20) if torch.cuda.is_available() else None,
        "cfg": {k: (v if isinstance(v, (int, float, str, bool, type(None))) else str(type(v).__name__))
                for k, v in sdk.default_kwargs.items()} | setup_kw,
    }
    (out / "timing.json").write_text(json.dumps(timing, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(timing))


if __name__ == "__main__":
    main()
