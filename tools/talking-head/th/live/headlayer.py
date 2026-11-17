"""Head-only motion (round 4): move the head, never the camera.

Round 3 warped the whole 512 frame, and the owner read every speech clip as camera shake: the
shoulders and the backdrop moved with the head. Here each frame is warped by a per-pixel field
instead: the transform from motion.py applies fully on the head and fades to nothing on the body and
the backdrop, which stay pixel-still.

The weight map `w` (H, W) in [0, 1] comes from MediaPipe's multiclass selfie segmenter (Apache-2.0,
`selfie_multiclass_256x256.tflite`; classes background, hair, body-skin, face-skin, clothes, others):
- head = hair, face-skin and others (accessories: the headset's ear cups); w = 1 there, and on the
  backdrop within HALO_PX of it, so thin strands and the mic boom move with the head;
- the backdrop beyond the halo fades to w = 0 over BG_FALL_PX (a dark, smooth backdrop: the stretch
  does not show, and with matting the alpha follows the same field);
- the neck bends instead of tearing: w = 1 down to JAW_PX below the closed-mouth chin (the jaw opens
  up to ~21 px at 512, so the chin never leaves the moving part), then a smoothstep to 0 over
  NECK_FALL_PX;
- clothes (jacket, collar, shoulders) are 0 and the neck and backdrop ramp up from them over SIDE_PX,
  so the collar's edge does not fold; every pixel whose weight rounds to nothing is 0 too, and
  those output pixels are copied from the input, bit for bit.
The rotation pivots below the chin at the neck centre (PIVOT_BELOW_CHIN px at 512).

Output pixel u samples the input at u + w(u) * D(u), where D is the displacement of the full head
transform (u_in = c + M^-1 (u - c - t)). Nothing is ever uncovered, so no clean plate is needed; a
rigid layer with a plate fill was the alternative, compared in docs/talking-head.md "Round 4".

The segmenter costs ~100 ms a frame on the CPU, so the map is built once from the reference at load
and refreshed off the GPU thread from one live frame per chunk (`observe`), smoothed over time
(EMA_KEEP), so it follows the gaze references and the idle loop without ever blocking a chunk.
"""

from __future__ import annotations

import hashlib
import math
import sys
import threading
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np

SEG_FILE = "selfie_multiclass_256x256.tflite"
SEG_URL = ("https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/"
           "float32/latest/" + SEG_FILE)
SEG_SHA256 = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"
SEG_CARD = "https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf"
BG, HAIR, BODY, FACE, CLOTHES, OTHERS = range(6)
SIZE_REF = 512.0  # the px constants below are at this size and scale with the frame
HALO_PX = 10.0
BG_FALL_PX = 40.0
JAW_PX = 24.0
NECK_FALL_PX = 44.0
SIDE_PX = 10.0  # beside the clothes the weight ramps up from 0 over this
SMOOTH_PX = 3.0  # Gaussian sigma on the map (no kinks in the field)
PIVOT_BELOW_CHIN = 28.0
EMA_KEEP = 0.7  # a refresh blends 30 % of the new frame's class map into the running one
EPS = 1e-3  # weights below this are exactly still


def seg_path() -> Path:
    from ..paths import models_dir

    return models_dir("selfie-multiclass") / SEG_FILE


def ensure_model() -> Path:
    """The segmenter's .tflite (16 MB, sha-pinned) with a licence.json beside it; fetched once."""
    p = seg_path()
    if p.is_file():
        return p
    print(f"th live: fetching the head segmenter {SEG_URL}", file=sys.stderr, flush=True)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(SEG_URL, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != SEG_SHA256:
        raise RuntimeError(f"{SEG_FILE}: sha256 mismatch")
    tmp = p.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(p)
    row = {"name": SEG_FILE, "licence": "Apache-2.0 (Model Card Multiclass Segmentation)", "url": SEG_URL,
           "revision": f"sha256:{SEG_SHA256}"}
    import json

    (p.parent / "licence.json").write_text(json.dumps([row], indent=2) + "\n", encoding="utf-8", newline="\n")
    return p


class Segmenter:
    """MediaPipe ImageSegmenter on the CPU: an RGB uint8 frame -> (H, W, 6) float32 class confidences."""

    def __init__(self) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        self._seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=str(ensure_model())),
            running_mode=vision.RunningMode.IMAGE, output_confidence_masks=True, output_category_mask=False))

    def __call__(self, frame: np.ndarray) -> np.ndarray:
        import mediapipe as mp

        r = self._seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame)))
        return np.stack([m.numpy_view() for m in r.confidence_masks], -1).astype(np.float32)

    def close(self) -> None:
        self._seg.close()


def _smooth(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def weights(conf: np.ndarray) -> tuple[np.ndarray, tuple[float, float], dict]:
    """Class confidences (H, W, 6) -> the weight map (H, W) float32, the pivot (x, y) in px, and
    info (chin, the still mask's share)."""
    import cv2

    h, w = conf.shape[:2]
    k = min(h, w) / SIZE_REF
    cls = conf.argmax(-1)
    head = np.isin(cls, (HAIR, FACE, OTHERS))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(head.astype(np.uint8), connectivity=8)
    if n > 1:  # the head is the largest blob; stray "others" pixels elsewhere stay still
        head = lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    face = (cls == FACE) & head
    if face.sum() < 16:  # no face found: treat the head blob's bottom as the chin
        face = head
    ys, xs = np.nonzero(face)
    cx = float(xs.mean()) if len(xs) else w / 2
    mid = np.abs(xs - cx) < max(2.0, 0.1 * (xs.max() - xs.min() + 1)) if len(xs) else np.zeros(0, bool)
    chin = float(ys[mid].max()) if mid.any() else 0.75 * h
    dist = cv2.distanceTransform((~head).astype(np.uint8), cv2.DIST_L2, 5)
    wb = 1.0 - _smooth((dist - HALO_PX * k) / (BG_FALL_PX * k))
    rows = np.arange(h, dtype=np.float32)[:, None]
    wn = np.broadcast_to(1.0 - _smooth((rows - chin - JAW_PX * k) / (NECK_FALL_PX * k)), (h, w))
    body = cls == BODY
    clothes = cls == CLOTHES
    side = _smooth(cv2.distanceTransform((~clothes).astype(np.uint8), cv2.DIST_L2, 5) / (SIDE_PX * k))
    # body-skin (the neck, the ears) by row; next to the collar the neck slides less (no fold)
    wmap = np.where(head, 1.0, np.where(body, wn, wb) * side).astype(np.float32)
    wmap = cv2.GaussianBlur(wmap, (0, 0), SMOOTH_PX * k, borderType=cv2.BORDER_REPLICATE)
    inner = cv2.erode(head.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    wmap = np.where(inner | (wmap > 1 - EPS), 1.0, np.where(clothes | (wmap < EPS), 0.0, wmap))
    wmap = np.clip(wmap, 0.0, 1.0).astype(np.float32)
    pivot = (cx, min(h - 1.0, chin + PIVOT_BELOW_CHIN * k))
    return wmap, pivot, {"chin": chin, "still": round(float((wmap == 0).mean()), 4)}


def geometric_conf(size: int) -> np.ndarray:
    """A stand-in class map without a segmenter (the fake model, tests): a head ellipse in the upper
    middle, a neck below it and clothes along the bottom quarter."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    conf = np.zeros((size, size, 6), np.float32)
    head = ((xx - 0.5) / 0.22) ** 2 + ((yy - 0.38) / 0.3) ** 2 <= 1
    neck = (np.abs(xx - 0.5) < 0.09) & (yy > 0.6) & (yy < 0.82)
    clothes = (yy >= 0.78) & ~neck
    conf[..., BG] = 1
    for mask, c in ((neck, BODY), (clothes, CLOTHES), (head, FACE)):
        conf[mask] = 0
        conf[mask, c] = 1
    return conf


def _matrices(params: np.ndarray, pivot: tuple[float, float], k: float) -> tuple[np.ndarray, np.ndarray]:
    """Per frame, D(u) = A u + b: the displacement (px, pixel-centre coordinates) from an output pixel
    to where the full head transform samples it. params rows: dx, dy (px at 512), rot (deg), scale."""
    n = len(params)
    a = np.zeros((n, 2, 2), np.float64)
    b = np.zeros((n, 2), np.float64)
    c = np.array(pivot, np.float64)
    for j, row in enumerate(np.asarray(params, np.float64)):
        dx, dy, rot, s = row[:4]
        r = math.radians(rot)
        m = s * np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
        mi = np.linalg.inv(m)
        a[j] = mi - np.eye(2)
        b[j] = c - mi @ (c + np.array([dx, dy]) * k)
    return a, b


class HeadLayer:
    """The current weight map and pivot; `apply` moves the head of a chunk's frames (and alpha)."""

    def __init__(self, conf: np.ndarray, segmenter: Any = None) -> None:
        self.size = conf.shape[0]
        self._conf = conf.astype(np.float32)
        self._seg = segmenter
        self.w, self.pivot, self.info = weights(self._conf)
        self._dev: dict[str, Any] = {}  # device -> (w tensor, still mask, version)
        self.version = 0
        self.refreshes = 0
        self._busy = threading.Lock()

    @classmethod
    def from_image(cls, path: Path, size: int) -> "HeadLayer":
        from PIL import Image

        seg = Segmenter()
        img = np.asarray(Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS))
        return cls(seg(img), seg)

    @classmethod
    def geometric(cls, size: int) -> "HeadLayer":
        return cls(geometric_conf(size))

    # ---- refresh (off the GPU thread) ------------------------------------------------------------

    def observe(self, frame: np.ndarray) -> bool:
        """Refresh the map from one live frame on a worker thread; skipped while one is running."""
        if self._seg is None or not self._busy.acquire(blocking=False):
            return False

        def run() -> None:
            try:
                conf = self._seg(frame)
                self._conf = EMA_KEEP * self._conf + (1 - EMA_KEEP) * conf
                w, pivot, info = weights(self._conf)
                self.w, self.pivot, self.info = w, pivot, info
                self.version += 1
                self.refreshes += 1
            except Exception as e:  # keep the last map; say why on the server log
                print(f"th live: head map refresh failed: {e!r}", file=sys.stderr, flush=True)
            finally:
                self._busy.release()

        threading.Thread(target=run, name="headlayer", daemon=True).start()
        return True

    def close(self) -> None:
        with self._busy:
            if self._seg is not None:
                self._seg.close()
                self._seg = None

    # ---- applying it -----------------------------------------------------------------------------

    def apply(self, frames: Any, params: np.ndarray, alpha: Any = None) -> tuple[Any, Any]:
        """Frames (N, H, W, 3) uint8 (CUDA tensor or numpy) and optional alpha (N, H, W) -> moved
        (same types). Pixels with w = 0 are copied unchanged."""
        n, h, wd = frames.shape[:3]
        wmap, pivot = self.w, self.pivot
        if wmap.shape != (h, wd):
            raise ValueError(f"head map {wmap.shape} for frames {(h, wd)}")
        a, b = _matrices(params[:, :4], pivot, min(h, wd) / SIZE_REF)
        if isinstance(frames, np.ndarray):
            return _apply_np(frames, alpha, wmap, a, b)
        return self._apply_torch(frames, alpha, a, b)

    def _apply_torch(self, frames: Any, alpha: Any, a: np.ndarray, b: np.ndarray) -> tuple[Any, Any]:
        import torch
        import torch.nn.functional as F

        dev = frames.device
        key = str(dev)
        cached = self._dev.get(key)
        if cached is None or cached[2] != self.version:
            wt = torch.from_numpy(self.w).to(dev)
            ys, xs = torch.nonzero(wt > 0, as_tuple=True)
            box = (int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1) if len(ys) else None
            cached = (wt, box, self.version)
            self._dev[key] = cached
        wt, box, _ = cached
        if box is None:
            return frames, alpha
        y0, y1, x0, x1 = box  # only the moving part is sampled; the rest is the input as it is
        n, h, w = frames.shape[:3]
        yy, xx = torch.meshgrid(torch.arange(y0, y1, device=dev, dtype=torch.float32),
                                torch.arange(x0, x1, device=dev, dtype=torch.float32), indexing="ij")
        at = torch.as_tensor(a, dtype=torch.float32, device=dev)
        bt = torch.as_tensor(b, dtype=torch.float32, device=dev)
        wsub = wt[y0:y1, x0:x1]
        ux = xx + wsub * (at[:, 0, 0, None, None] * xx + at[:, 0, 1, None, None] * yy + bt[:, 0, None, None])
        uy = yy + wsub * (at[:, 1, 0, None, None] * xx + at[:, 1, 1, None, None] * yy + bt[:, 1, None, None])
        grid = torch.stack([(2 * ux + 1) / w - 1, (2 * uy + 1) / h - 1], -1)  # fp32: fp16 grids jitter
        src = frames.permute(0, 3, 1, 2).float()
        if alpha is not None:
            src = torch.cat([src, alpha[:, None].float()], 1)
        o = F.grid_sample(src, grid, mode="bilinear", padding_mode="border", align_corners=False)
        o = o.round_().clamp_(0, 255).to(torch.uint8)
        moving = (wsub > 0)[None, :, :, None]
        out = frames.clone()
        out[:, y0:y1, x0:x1] = torch.where(moving, o[:, :3].permute(0, 2, 3, 1), frames[:, y0:y1, x0:x1])
        if alpha is None:
            return out, None
        al = alpha.clone()
        al[:, y0:y1, x0:x1] = torch.where(moving[..., 0], o[:, 3], alpha[:, y0:y1, x0:x1])
        return out, al


def _apply_np(frames: np.ndarray, alpha: Any, wmap: np.ndarray, a: np.ndarray, b: np.ndarray) -> tuple[Any, Any]:
    """The same sampling in numpy (the fake model and tests): bilinear, edges clamped."""
    n, h, w = frames.shape[:3]
    src = frames.astype(np.float32)
    if alpha is not None:
        src = np.concatenate([src, alpha[..., None].astype(np.float32)], -1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    moving = wmap > 0
    out = src.copy()
    for i in range(n):
        ux = np.clip(xx + wmap * (a[i, 0, 0] * xx + a[i, 0, 1] * yy + b[i, 0]), 0, w - 1)[moving]
        uy = np.clip(yy + wmap * (a[i, 1, 0] * xx + a[i, 1, 1] * yy + b[i, 1]), 0, h - 1)[moving]
        x0, y0 = np.floor(ux).astype(np.int64), np.floor(uy).astype(np.int64)
        x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
        fx, fy = (ux - x0)[:, None], (uy - y0)[:, None]
        f = src[i]
        top = f[y0, x0] * (1 - fx) + f[y0, x1] * fx
        bot = f[y1, x0] * (1 - fx) + f[y1, x1] * fx
        out[i][moving] = top * (1 - fy) + bot * fy
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    rgb = out[..., :3].copy()
    return rgb, None if alpha is None else out[..., 3].copy()
