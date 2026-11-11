"""Shared helpers: image and JSON I/O as bytes (LF only), soft masks, the push-pull fill.

Every image here is float32 in [0, 1], H x W x C, RGB order (OpenCV's BGR stays inside `read_*`).
"""
from __future__ import annotations

import io
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# One thread: OpenCV's parallel reductions are not bit-stable across runs, and a rebuild must write
# the same bytes.
cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)

SIZE = 1024


def read_rgb(path: Path) -> np.ndarray:
    im = Image.open(path)
    im.load()
    return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def read_rgba(path: Path) -> np.ndarray:
    im = Image.open(path)
    im.load()
    return np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0


def to_u8(img: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(img * 255.0), 0, 255).astype(np.uint8)


def area_resize(img: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """`size` is (w, h)."""
    return cv2.resize(img, size, interpolation=cv2.INTER_AREA)


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def json_bytes(obj: object) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def write_json(path: Path, obj: object) -> None:
    write_bytes(path, json_bytes(obj))


def write_text(path: Path, text: str) -> None:
    write_bytes(path, text.replace("\r\n", "\n").encode("utf-8"))


def read_json(path: Path) -> dict:
    with open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def webp_bytes(img: np.ndarray, quality: int = 92, lossless: bool = False) -> bytes:
    """RGB or RGBA (straight alpha). `exact` keeps the colour under alpha 0 (it is the extended
    colour, so bilinear filtering at an edge never pulls in black)."""
    u8 = to_u8(img)
    mode = "RGBA" if u8.shape[2] == 4 else "RGB"
    buf = io.BytesIO()
    opts = {"lossless": True, "quality": 100, "method": 6} if lossless else {"quality": quality, "method": 6, "alpha_quality": 100}
    Image.fromarray(u8, mode).save(buf, "WEBP", exact=True, **opts)
    return buf.getvalue()


def png_bytes(u8: np.ndarray) -> bytes:
    buf = io.BytesIO()
    mode = {1: "L", 3: "RGB", 4: "RGBA"}[1 if u8.ndim == 2 else u8.shape[2]]
    Image.fromarray(u8, mode).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def decode(data: bytes, mode: str = "RGBA") -> np.ndarray:
    im = Image.open(io.BytesIO(data))
    im.load()
    return np.asarray(im.convert(mode), dtype=np.float32) / 255.0


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return img
    return cv2.GaussianBlur(img, (0, 0), sigma, borderType=cv2.BORDER_REFLECT)


def feather(mask: np.ndarray, px: float) -> np.ndarray:
    """A soft edge about `px` wide (a Gaussian of sigma px/2)."""
    return np.clip(gauss(mask.astype(np.float32), px / 2.0), 0.0, 1.0)


def dilate(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0


def erode(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.erode(mask.astype(np.uint8), k) > 0


def distance_from(mask: np.ndarray) -> np.ndarray:
    """Euclidean px from each pixel to the nearest pixel of `mask` (0 on it)."""
    return cv2.distanceTransform((~mask.astype(bool)).astype(np.uint8), cv2.DIST_L2, 5)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def nblur(img: np.ndarray, w: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """Normalised blur: the w-weighted local mean of img, and the local weight."""
    w = w.astype(np.float32)
    num = gauss(img * (w[..., None] if img.ndim == 3 else w), sigma)
    den = gauss(w, sigma)
    out = num / np.maximum(den, 1e-6)[..., None] if img.ndim == 3 else num / np.maximum(den, 1e-6)
    return out, den


def pushpull(img: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Fill where the weight is 0 from the nearest weighted pixels, coarse to fine; a pixel of
    weight 1 keeps its value exactly."""
    squeeze = img.ndim == 2
    if squeeze:
        img = img[..., None]
    w = np.clip(w.astype(np.float32), 0.0, 1.0)
    levels = [(img * w[..., None], w)]
    while max(levels[-1][1].shape) > 2:
        s, ww = levels[-1]
        h, wd = ww.shape
        size = (max(1, math.ceil(wd / 2)), max(1, math.ceil(h / 2)))
        s2 = cv2.resize(s, size, interpolation=cv2.INTER_AREA)
        if s2.ndim == 2:
            s2 = s2[..., None]
        levels.append((s2, cv2.resize(ww, size, interpolation=cv2.INTER_AREA)))
    s, ww = levels[-1]
    col = s / np.maximum(ww, 1e-8)[..., None]
    mean = img.reshape(-1, img.shape[2])[w.reshape(-1) > 0].mean(0) if (w > 0).any() else np.zeros(img.shape[2], np.float32)
    col = np.where(ww[..., None] > 1e-8, col, mean)
    for s, ww in reversed(levels[:-1]):
        h, wd = ww.shape
        up = cv2.resize(col, (wd, h), interpolation=cv2.INTER_LINEAR)
        if up.ndim == 2:
            up = up[..., None]
        a = np.clip(ww, 0.0, 1.0)[..., None]
        own = s / np.maximum(ww, 1e-8)[..., None]
        col = np.where(ww[..., None] > 1e-8, a * own + (1.0 - a) * up, up)
    col = col.astype(np.float32)
    return col[..., 0] if squeeze else col


def region_mask(region: dict, shape: tuple[int, int]) -> np.ndarray:
    """A recipe region (`ellipses: [[cx, cy, rx, ry], ...]` and/or `box: [x, y, w, h]`) as a
    binary float mask."""
    h, w = shape
    m = np.zeros((h, w), np.uint8)
    for cx, cy, rx, ry in region.get("ellipses", []):
        cv2.ellipse(m, (int(round(cx)), int(round(cy))), (int(round(rx)), int(round(ry))), 0, 0, 360, 1, -1)
    if "box" in region:
        x, y, bw, bh = region["box"]
        m[max(0, y):y + bh, max(0, x):x + bw] = 1
    return m.astype(np.float32)


def alpha_box(alpha: np.ndarray, pad: int, thr: float = 0.5 / 255.0) -> tuple[int, int, int, int]:
    """[x, y, w, h] of alpha > thr, padded and clipped to the image."""
    ys, xs = np.nonzero(alpha > thr)
    h, w = alpha.shape
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(w, int(xs.max()) + 1 + pad), min(h, int(ys.max()) + 1 + pad)
    return x0, y0, x1 - x0, y1 - y0


def grey(img: np.ndarray) -> np.ndarray:
    return (img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114).astype(np.float32)
