"""SyncNet v2 lip-sync confidence and offset, the standard LSE-C / LSE-D evaluation.

Model and procedure follow joonson/syncnet_python (MIT; SyncNetModel.py, SyncNetInstance.py,
run_pipeline.py crop_video), the same code LatentSync vendors in eval/syncnet (Apache-2.0).
Weights: the original syncnet_v2.model from VGG (see th.fetch). Video runs at 25 fps, audio at
16 kHz mono; one lip window is 5 frames against 20 MFCC steps. `offsetFrames` is in those 25 fps
frames (40 ms each); positive means the picture runs late against the audio.
"""

from __future__ import annotations

import numpy as np

from ..fetch import require
from .face import Box

FPS = 25
CROP = 224
CROP_SCALE = 0.4  # syncnet_python crop_video default
VSHIFT = 15


def _model():
    import torch.nn as nn

    def c2(i, o, k, s=(1, 1), p=(1, 1)):
        return [nn.Conv2d(i, o, k, s, p), nn.BatchNorm2d(o), nn.ReLU(inplace=True)]

    def c3(i, o, k, s=(1, 1, 1), p=(0, 0, 0)):
        return [nn.Conv3d(i, o, k, s, p), nn.BatchNorm3d(o), nn.ReLU(inplace=True)]

    def fc():
        return nn.Sequential(nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, 1024))

    class S(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.netcnnaud = nn.Sequential(
                *c2(1, 64, (3, 3)), nn.MaxPool2d((1, 1), (1, 1)),
                *c2(64, 192, (3, 3)), nn.MaxPool2d((3, 3), (1, 2)),
                *c2(192, 384, (3, 3)), *c2(384, 256, (3, 3)), *c2(256, 256, (3, 3)),
                nn.MaxPool2d((3, 3), (2, 2)),
                nn.Conv2d(256, 512, (5, 4), (1, 1), (0, 0)), nn.BatchNorm2d(512), nn.ReLU(),
            )
            self.netfcaud = fc()
            self.netfclip = fc()
            self.netcnnlip = nn.Sequential(
                *c3(3, 96, (5, 7, 7), (1, 2, 2), 0), nn.MaxPool3d((1, 3, 3), (1, 2, 2)),
                *c3(96, 256, (1, 5, 5), (1, 2, 2), (0, 1, 1)), nn.MaxPool3d((1, 3, 3), (1, 2, 2), (0, 1, 1)),
                *c3(256, 256, (1, 3, 3), (1, 1, 1), (0, 1, 1)),
                *c3(256, 256, (1, 3, 3), (1, 1, 1), (0, 1, 1)),
                *c3(256, 256, (1, 3, 3), (1, 1, 1), (0, 1, 1)),
                nn.MaxPool3d((1, 3, 3), (1, 2, 2)),
                *c3(256, 512, (1, 6, 6), (1, 1, 1), 0),
            )

        def forward_aud(self, x):
            return self.netfcaud(self.netcnnaud(x).flatten(1))

        def forward_lip(self, x):
            return self.netfclip(self.netcnnlip(x).flatten(1))

    return S()


def smooth_boxes(boxes: list[Box | None]) -> list[Box] | None:
    """Fill gaps from neighbours and median-filter centre and size (kernel 13), as crop_video does."""
    from scipy.signal import medfilt

    idx = [i for i, b in enumerate(boxes) if b is not None]
    if len(idx) < max(5, len(boxes) // 2):
        return None
    arr = np.array([boxes[i] for i in idx], np.float64)
    full = np.stack([np.interp(np.arange(len(boxes)), idx, arr[:, k]) for k in range(4)], 1)
    cx, cy = (full[:, 0] + full[:, 2]) / 2, (full[:, 1] + full[:, 3]) / 2
    s = np.maximum(full[:, 2] - full[:, 0], full[:, 3] - full[:, 1]) / 2
    k = 13 if len(boxes) >= 13 else (len(boxes) // 2) * 2 + 1
    cx, cy, s = medfilt(cx, k), medfilt(cy, k), medfilt(s, k)
    return [(x - b, y - b, x + b, y + b) for x, y, b in zip(cx, cy, s)]


def crop_for_syncnet(rgb: np.ndarray, box: Box) -> np.ndarray:
    """syncnet_python's crop: pad with grey 110, take bs above to bs*(1+2cs) below the centre,
    bs*(1+cs) either side, resize to 224. Returns BGR uint8 (the network was trained on cv2 BGR)."""
    from PIL import Image

    x0, y0, x1, y1 = box
    bs = max(x1 - x0, y1 - y0) / 2
    cs = CROP_SCALE
    bsi = int(bs * (1 + 2 * cs))
    frame = np.pad(rgb, ((bsi, bsi), (bsi, bsi), (0, 0)), constant_values=110)
    my, mx = (y0 + y1) / 2 + bsi, (x0 + x1) / 2 + bsi
    face = frame[int(my - bs):int(my + bs * (1 + 2 * cs)), int(mx - bs * (1 + cs)):int(mx + bs * (1 + cs))]
    face = np.asarray(Image.fromarray(face).resize((CROP, CROP), Image.BILINEAR))
    return face[:, :, ::-1]


def evaluate(crops_bgr: list[np.ndarray], audio16k: np.ndarray, device: str = "cuda",
             batch: int = 20) -> tuple[float, int]:
    """(conf, offsetFrames) over the clip. conf = median(mean dists over shifts) - min; offset =
    VSHIFT - argmin, so a positive offset means the picture runs late against the audio
    (syncnet_python's convention: audio has to be delayed by `offset` frames to align)."""
    import python_speech_features
    import torch

    net = _model().to(device).eval()
    state = torch.load(str(require("syncnet") / "syncnet_v2.model"), map_location="cpu", weights_only=True)
    net.load_state_dict(state)

    mfcc = np.stack([np.array(c) for c in zip(*python_speech_features.mfcc(audio16k, 16000))])
    cct = torch.from_numpy(mfcc[None, None].astype(np.float32))
    n = min(len(crops_bgr), len(audio16k) // 640)
    last = n - 5
    if last <= 2 * VSHIFT:
        raise ValueError(f"clip too short for SyncNet ({n} frames at {FPS} fps)")
    vid = np.stack(crops_bgr[:n])  # T, H, W, C
    im_feat, cc_feat = [], []
    with torch.inference_mode():
        for i in range(0, last, batch):
            js = range(i, min(last, i + batch))
            ims = np.stack([vid[j:j + 5] for j in js]).astype(np.float32)  # B, 5, H, W, C
            im = torch.from_numpy(ims).permute(0, 4, 1, 2, 3).to(device)  # B, C, 5, H, W
            im_feat.append(net.forward_lip(im).float().cpu())
            cc = torch.cat([cct[:, :, :, j * 4:j * 4 + 20] for j in js], 0).to(device)
            cc_feat.append(net.forward_aud(cc).float().cpu())
    f1, f2 = torch.cat(im_feat), torch.cat(cc_feat)
    win = 2 * VSHIFT + 1
    f2p = torch.nn.functional.pad(f2, (0, 0, VSHIFT, VSHIFT))
    dists = torch.stack([torch.nn.functional.pairwise_distance(f1[[i]].repeat(win, 1), f2p[i:i + win])
                         for i in range(len(f1))], 1)
    mean = dists.mean(1)
    min_d, idx = torch.min(mean, 0)
    conf = float(torch.median(mean) - min_d)
    del net
    if device == "cuda":
        torch.cuda.empty_cache()
    return conf, int(VSHIFT - idx)
