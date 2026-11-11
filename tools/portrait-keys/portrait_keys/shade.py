"""The design's "Shader" section (with its round 2 amendment: back cell and reveal) in numpy, read from the files as written (atlas, flow image, head
layer), so a review strip shows what the renderer will draw.

Sampling convention (the same as a GL texture with linear filtering): canvas pixel centres sit at
integer + 0.5; a key's cell is stretched over its bbox, so canvas point p reads the cell at
`cell.xy + (p - bbox.xy) * cell.wh / bbox.wh`; outside the bbox a key has no motion and no colour.
"""
from __future__ import annotations

import cv2
import numpy as np

GROUPS = {"joy": 0, "showman": 0, "anger": 0, "gloom": 0, "smug": 0, "suspicion": 0,
          "gazeL": 1, "gazeR": 1, "gazeU": 1, "gazeD": 1,
          "openWide": 2, "openMid": 2, "round": 2, "closed": 2, "teeth": 2, "tongue": 2, "narrow": 2,
          "blink": 3}


def _sample(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear read at continuous texture coords (texel centres at integer + 0.5), edge clamped."""
    return cv2.remap(img, (u - 0.5).astype(np.float32), (v - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


class Morph:
    """A morph layer: the head layer as canvas-size premultiplied RGBA, the atlas, the flow codes and the keys."""

    def __init__(self, head_rgba: np.ndarray, atlas: np.ndarray, flow: np.ndarray | None, keys: list[dict]):
        self.head = head_rgba.copy()
        self.head[..., :3] *= self.head[..., 3:4]
        self.atlas = atlas
        self.flow = flow
        self.keys = keys

    def _in_box(self, k: dict, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        x, y, w, h = k["bbox"]
        return (px >= x) & (px <= x + w) & (py >= y) & (py <= y + h)

    def _flow_read(self, k: dict, name: str, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        """The raw RGB of a key's motion-image cell (`flowCell` or `backCell`) at canvas points."""
        x, y, w, h = k["bbox"]
        cx, cy, cw, ch = k[name]
        u = cx + np.clip((px - x) * cw / w, 0.5, cw - 0.5)
        v = cy + np.clip((py - y) * ch / h, 0.5, ch - 0.5)
        return _sample(self.flow, u, v)

    def motion(self, k: dict, px: np.ndarray, py: np.ndarray, name: str = "flowCell") -> np.ndarray:
        """F (flowCell, layer frame) or G (backCell, key frame) in canvas px; 0 outside the bbox."""
        if name not in k or self.flow is None:
            return np.zeros(px.shape + (2,), np.float32)
        code = self._flow_read(k, name, px, py)[..., :2]
        f = (code * 255.0 - 128.0) / 127.0 * k["flowMax"]
        return np.where(self._in_box(k, px, py)[..., None], f, 0.0).astype(np.float32)

    def reveal(self, k: dict, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        if "backCell" not in k or self.flow is None:
            return np.zeros(px.shape, np.float32)
        return np.where(self._in_box(k, px, py), self._flow_read(k, "backCell", px, py)[..., 2], 0.0).astype(np.float32)

    def colour(self, k: dict, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        x, y, w, h = k["bbox"]
        cx, cy, cw, ch = k["cell"]
        u = cx + (px - x) * cw / w
        v = cy + (py - y) * ch / h
        c = _sample(self.atlas, u, v)
        c[..., 3] = np.where(self._in_box(k, px, py), c[..., 3], 0.0)
        return c

    def render(self, weights: dict[str, float], box: tuple[int, int, int, int] | None = None) -> np.ndarray:
        """Premultiplied RGBA of the morph layer (canvas size, or `box`) at key weights by id."""
        H, W = self.head.shape[:2]
        bx, by, bw, bh = box or (0, 0, W, H)
        gx, gy = np.meshgrid(np.arange(bx, bx + bw, dtype=np.float32) + 0.5, np.arange(by, by + bh, dtype=np.float32) + 0.5)
        active = [(k, weights[k["id"]]) for k in self.keys if weights.get(k["id"], 0.0) > 0.002]

        # Round 2 amendment: no fixed point. Fh_i(x) = mix(F_i(x), -G_i(x), w_i), all at x.
        fh = []
        for k, w in active:
            f = self.motion(k, gx, gy)
            if "backCell" in k:
                f = (1.0 - w) * f + w * (-self.motion(k, gx, gy, "backCell"))
            fh.append(f)
        d = np.zeros(gx.shape + (2,), np.float32)
        for (k, w), f in zip(active, fh):
            d += w * f
        px, py = gx - d[..., 0], gy - d[..., 1]
        c = _sample(self.head, px, py)
        for group in range(4):
            members = [(k, w, f) for (k, w), f in zip(active, fh) if GROUPS[k["track"]] == group]
            if not members:
                continue
            S = np.zeros(px.shape, np.float32)
            C = np.zeros(px.shape + (3,), np.float32)
            for k, w, f in members:
                qx, qy = px + f[..., 0], py + f[..., 1]
                kc = self.colour(k, qx, qy)
                r = self.reveal(k, qx, qy)
                t = min(1.0, max(0.0, w / 0.4))
                a = (1.0 - r) * w + r * (t * t * (3.0 - 2.0 * t))
                S += a * kc[..., 3]
                C += (a * kc[..., 3])[..., None] * kc[..., :3]
            C /= np.maximum(S, 1e-4)[..., None]
            t = np.minimum(1.0, S)[..., None]
            c[..., :3] = (1.0 - t) * c[..., :3] + t * C * c[..., 3:4]
        return c


def place(layer: np.ndarray, bbox: list[int], size: int) -> np.ndarray:
    """A cropped straight-alpha layer back on a canvas."""
    out = np.zeros((size, size, layer.shape[2]), np.float32)
    x, y, w, h = bbox
    out[y:y + h, x:x + w] = layer
    return out


def over(premul: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Premultiplied RGBA over an opaque RGB base."""
    return premul[..., :3] + (1.0 - premul[..., 3:4]) * base


def straight_over(rgba: np.ndarray, base: np.ndarray) -> np.ndarray:
    a = rgba[..., 3:4]
    return rgba[..., :3] * a + (1.0 - a) * base


def track_weights(keys: list[dict], track: str, v: float) -> dict[str, float]:
    """The stop rule (design "Tracks") for one track's keys at value v."""
    stops = sorted([k for k in keys if k["track"] == track], key=lambda k: k.get("at", 1.0))
    out = {k["id"]: 0.0 for k in stops}
    prev_at, prev = 0.0, None
    for k in stops:
        at = k.get("at", 1.0)
        if v <= at:
            t = (v - prev_at) / (at - prev_at) if at > prev_at else 1.0
            out[k["id"]] = max(0.0, t)
            if prev is not None:
                out[prev["id"]] = 1.0 - max(0.0, t)
            return out
        prev_at, prev = at, k
    if prev is not None:
        out[prev["id"]] = 1.0
    return out
