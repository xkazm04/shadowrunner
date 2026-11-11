"""Review sheets (design "Builder" step 6, brief C): layers over magenta, white and black with 2x
zooms, the head-shift seam check, a five-weight strip per key, a stop strip per multi-stop track,
and the contact sheet. JPEG, for looking at; never shipped."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .common import to_u8, write_bytes
from .shade import Morph, over, straight_over, track_weights

GROUNDS = {"magenta": (1.0, 0.0, 1.0), "white": (1.0, 1.0, 1.0), "black": (0.0, 0.0, 0.0)}
GREY = 0.35


def jpg(path: Path, img: np.ndarray) -> None:
    ok, buf = cv2.imencode(".jpg", to_u8(img)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    write_bytes(path, buf.tobytes())


def label(img: np.ndarray, text: str) -> np.ndarray:
    out = np.ascontiguousarray(to_u8(img))
    cv2.putText(out, text, (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(out, text, (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 80), 1, cv2.LINE_AA)
    return out.astype(np.float32) / 255.0


def zoom(img: np.ndarray, f: int) -> np.ndarray:
    return cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST) if f > 1 else img


def hcat(tiles: list[np.ndarray], gap: int = 4) -> np.ndarray:
    h = max(t.shape[0] for t in tiles)
    cols = []
    for t in tiles:
        cols.append(np.pad(t, ((0, h - t.shape[0]), (0, 0), (0, 0)), constant_values=GREY))
        cols.append(np.full((h, gap, 3), GREY, np.float32))
    return np.hstack(cols[:-1])


def vcat(rows: list[np.ndarray], gap: int = 4) -> np.ndarray:
    w = max(r.shape[1] for r in rows)
    out = []
    for r in rows:
        out.append(np.pad(r, ((0, 0), (0, w - r.shape[1]), (0, 0)), constant_values=GREY))
        out.append(np.full((gap, w, 3), GREY, np.float32))
    return np.vstack(out[:-1])


def layer_sheets(out: Path, layers: dict[str, np.ndarray], inspect: list[list[int]]) -> None:
    """`layers`: canvas-size straight RGBA of head and body. One sheet per layer: the whole layer
    over each ground at half size, then every inspect box at 2x over each ground."""
    for name, rgba in layers.items():
        rows = [hcat([label(cv2.resize(straight_over(rgba, np.array(c, np.float32)), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), f"{name} / {g}") for g, c in GROUNDS.items()])]
        for x, y, w, h in inspect:
            crop = rgba[y:y + h, x:x + w]
            rows.append(hcat([label(zoom(straight_over(crop, np.array(c, np.float32)), 2), f"{x},{y} 2x") for c in GROUNDS.values()]))
        jpg(out / f"layer-{name}.jpg", vcat(rows))


def seam_sheet(out: Path, background: np.ndarray, body: np.ndarray, head: np.ndarray, jaw_box: list[int], shift: tuple[int, int] = (6, 4)) -> None:
    """The head moved by `shift` over the body: over the background and over magenta (a hole or a
    line shows), whole and at 3x around the jaw."""
    M = np.float32(np.array([[1, 0, shift[0]], [0, 1, shift[1]]]))
    moved = cv2.warpAffine(head, M, (head.shape[1], head.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    tiles = []
    for name, ground in (("background", background), ("magenta", np.broadcast_to(np.array(GROUNDS["magenta"], np.float32), background.shape).copy())):
        base = straight_over(body, ground)
        for tag, h in (("rest", head), (f"head +{shift[0]},+{shift[1]}", moved)):
            img = straight_over(h, base)
            x, y, w, hh = jaw_box
            tiles.append((name, tag, img, img[y:y + hh, x:x + w]))
    rows = [hcat([label(cv2.resize(t[2], None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), f"{t[0]} {t[1]}") for t in tiles])]
    rows.append(hcat([label(zoom(t[3], 3), f"{t[0]} {t[1]} 3x") for t in tiles[:2]]))
    rows.append(hcat([label(zoom(t[3], 3), f"{t[0]} {t[1]} 3x") for t in tiles[2:]]))
    jpg(out / "seam.jpg", vcat(rows))


def _frame(morph: Morph, under: np.ndarray, weights: dict[str, float], box: list[int]) -> np.ndarray:
    x, y, w, h = box
    return over(morph.render(weights, (x, y, w, h)), under[y:y + h, x:x + w])


def key_strips(out: Path, morph: Morph, under: np.ndarray, size: int) -> None:
    """Per key: weights 0, .25, .5, .75, 1 (top), and the plain cross-fade of the same cell for
    comparison (bottom) when the key has motion. Per multi-stop track: the track value in nine steps."""
    for k in morph.keys:
        x, y, w, h = k["bbox"]
        pad = 16
        box = [max(0, x - pad), max(0, y - pad), min(size, x + w + pad) - max(0, x - pad), min(size, y + h + pad) - max(0, y - pad)]
        f = max(1, min(3, int(np.ceil(220 / box[3]))))
        rows = [hcat([label(zoom(_frame(morph, under, {k["id"]: t}, box), f), f"{k['id']} {t:.2f}") for t in (0, 0.25, 0.5, 0.75, 1.0)])]
        if "flowCell" in k:
            plain = Morph.__new__(Morph)
            plain.head, plain.atlas, plain.flow = morph.head, morph.atlas, None
            plain.keys = [{kk: vv for kk, vv in k.items() if kk not in ("flowCell", "flowMax")}]
            rows.append(hcat([label(zoom(_frame(plain, under, {k["id"]: t}, box), f), f"fade {t:.2f}") for t in (0, 0.25, 0.5, 0.75, 1.0)]))
        jpg(out / f"key-{k['id']}.jpg", vcat(rows))
    tracks = sorted({k["track"] for k in morph.keys if sum(1 for j in morph.keys if j["track"] == k["track"]) > 1})
    for track in tracks:
        ks = [k for k in morph.keys if k["track"] == track]
        x0 = min(k["bbox"][0] for k in ks)
        y0 = min(k["bbox"][1] for k in ks)
        x1 = max(k["bbox"][0] + k["bbox"][2] for k in ks)
        y1 = max(k["bbox"][1] + k["bbox"][3] for k in ks)
        box = [x0, y0, x1 - x0, y1 - y0]
        f = max(1, min(3, int(np.ceil(160 / box[3]))))
        tiles = [label(zoom(_frame(morph, under, track_weights(morph.keys, track, v), box), f), f"{track} {v:.3f}") for v in np.linspace(0, 1, 9)]
        jpg(out / f"track-{track}.jpg", vcat([hcat(tiles[:5]), hcat(tiles[5:])]))


def contact(out: Path, morph: Morph, under: np.ndarray, face_box: list[int], name: str) -> None:
    """Every key at weight 1 on the composed character, cropped to the face, five to a row."""
    tiles = [label(_frame(morph, under, {}, face_box), f"{name} rest")]
    tiles += [label(_frame(morph, under, {k["id"]: 1.0}, face_box), k["id"]) for k in morph.keys]
    rows = [hcat(tiles[i:i + 5]) for i in range(0, len(tiles), 5)]
    jpg(out / "contact.jpg", vcat(rows))


def sway_sheet(out: Path, head: np.ndarray, sway: np.ndarray) -> None:
    """The sway weight in red over the head layer (grey)."""
    g = head[..., :3].mean(-1, keepdims=True) * head[..., 3:4]
    img = np.concatenate([np.maximum(g[..., 0], sway)[..., None], g, g], axis=-1)
    jpg(out / "sway.jpg", cv2.resize(img, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
