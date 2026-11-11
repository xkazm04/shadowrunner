"""The key atlas and the motion image (design "Data", "Builder" step 5): shelf packing with gutters."""
from __future__ import annotations

import math

import cv2
import numpy as np

ATLAS_MAX = 2048
ATLAS_GUTTER = 2
FLOW_GUTTER = 1
FLOW_SCALE = 4


def shelf(sizes: list[tuple[int, int]], width: int) -> tuple[list[tuple[int, int]], int]:
    """Top-left of each (w, h) box on shelves `width` wide (input order kept), and the height used."""
    x = y = shelf_h = 0
    places = []
    for w, h in sizes:
        if x + w > width:
            x, y, shelf_h = 0, y + shelf_h, 0
        places.append((x, y))
        x += w
        shelf_h = max(shelf_h, h)
    return places, y + shelf_h


def pack(sizes: list[tuple[int, int]], limit: int) -> tuple[list[tuple[int, int]], int, int]:
    """Places for padded boxes in the smallest-area image at most `limit` square (widths in steps
    of 64, tallest boxes first); raises when they do not fit."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0], i))
    best = None
    widest = max(w for w, _ in sizes)
    for width in range(max(64, int(math.ceil(widest / 64)) * 64), limit + 1, 64):
        places, height = shelf([sizes[i] for i in order], width)
        if height > limit:
            continue
        used_w = max(px + sizes[i][0] for (px, _), i in zip(places, order))
        area = used_w * height
        if best is None or area < best[0]:
            best = (area, places, used_w, height)
    if best is None:
        raise ValueError(f"the cells do not fit a {limit} x {limit} image: {sizes}")
    _, places, used_w, height = best
    out = [(0, 0)] * len(sizes)
    for (px, py), i in zip(places, order):
        out[i] = (px, py)
    return out, used_w, height


def atlas(cells: list[np.ndarray]) -> tuple[np.ndarray, list[list[int]]]:
    """RGBA cells (straight alpha) -> the atlas and each cell's [x, y, w, h] (inside its gutter)."""
    g = ATLAS_GUTTER
    padded = [cv2.copyMakeBorder(c, g, g, g, g, cv2.BORDER_REPLICATE) for c in cells]
    places, w, h = pack([(p.shape[1], p.shape[0]) for p in padded], ATLAS_MAX)
    img = np.zeros((h, w, 4), np.float32)
    rects = []
    for (x, y), p, c in zip(places, padded, cells):
        img[y:y + p.shape[0], x:x + p.shape[1]] = p
        rects.append([x + g, y + g, c.shape[1], c.shape[0]])
    return img, rects


def flow_cell_size(bw: int, bh: int) -> tuple[int, int]:
    return int(math.ceil(bw / FLOW_SCALE)), int(math.ceil(bh / FLOW_SCALE))


def encode_flow(f: np.ndarray, flow_max: float) -> np.ndarray:
    """Canvas px -> codes, `(code - 128) / 127 * flowMax`; 128 is exactly zero."""
    code = np.clip(np.rint(128.0 + f / flow_max * 127.0), 1, 255)
    return code.astype(np.uint8)


def flow_image(fields: list[tuple[np.ndarray, np.ndarray, np.ndarray]], maxes: list[float]) -> tuple[np.ndarray, list[list[int]], list[list[int]]]:
    """Per key (F, G, reveal) at bbox size -> the RGB code image and each key's forward cell
    (R, G = F, B = 128) and back cell (R, G = G, B = reveal * 255), [x, y, w, h] at 1/4 size."""
    g = FLOW_GUTTER
    cells = []
    for (f, gb, rv), m in zip(fields, maxes):
        cw, ch = flow_cell_size(f.shape[1], f.shape[0])
        fwd = encode_flow(cv2.resize(f, (cw, ch), interpolation=cv2.INTER_AREA), m)
        bck = encode_flow(cv2.resize(gb, (cw, ch), interpolation=cv2.INTER_AREA), m)
        rv8 = np.clip(np.rint(cv2.resize(rv, (cw, ch), interpolation=cv2.INTER_AREA) * 255.0), 0, 255).astype(np.uint8)
        cells.append(np.dstack([fwd, np.full((ch, cw), 128, np.uint8)]))
        cells.append(np.dstack([bck, rv8]))
    padded = [cv2.copyMakeBorder(c, g, g, g, g, cv2.BORDER_REPLICATE) for c in cells]
    places, w, h = pack([(p.shape[1], p.shape[0]) for p in padded], ATLAS_MAX)
    img = np.full((h, w, 3), 128, np.uint8)
    rects = []
    for (x, y), p, c in zip(places, padded, cells):
        img[y:y + p.shape[0], x:x + p.shape[1]] = p
        rects.append([x + g, y + g, c.shape[1], c.shape[0]])
    return img, rects[0::2], rects[1::2]
