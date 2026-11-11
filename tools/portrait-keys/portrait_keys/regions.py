"""Recolour regions (docs/rig-format.md "Regions"): an index map per layer from a recipe rule per
slot, so the creator's colour controls work on a portrait-lane character.

recipe `recolour`: { <layer>: [ { id, name, parts: [ { within?: [shape], without?: [shape],
colour?: [test], except?: [test] } ] } ] } with a shape a recipe region ({ellipses} | {box}) and a
test { hue?: [[lo, hi], ...], sat?: [lo, hi], light?: [lo, hi], warm?: [lo, hi] (R - B) } on the layer's own (un-mixed)
colour in HSL (as packages/avatar/src/render/recolour.ts). A part takes the pixels inside any
`within` (all when absent), outside every `without`, matching any `colour` test (all when absent)
and no `except` test. A slot is the union of its parts; slots are taken in order, the first wins.

It is an index map read NEAREST, so every pixel belongs to one slot or none: the boundary sits
where the colour test flips on the un-mixed colour (a strand's soft edge keeps the strand's slot,
because its colour is the strand's, not the ground's), then small specks are removed and the map
is carried 4 px past the layer's alpha so a displaced read at an edge stays in its slot.
"""
from __future__ import annotations

import cv2
import numpy as np

from .common import region_mask
from .matte import nearest_extend


def hsl(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    l = (mx + mn) / 2
    d = mx - mn
    s = np.where(d > 0, d / np.maximum(1 - np.abs(2 * l - 1), 1e-6), 0.0)
    safe = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) / 6
    return np.where(d > 0, h, 0.0), np.clip(s, 0, 1), l


def _test(t: dict, h: np.ndarray, s: np.ndarray, l: np.ndarray, warm: np.ndarray) -> np.ndarray:
    m = np.ones(h.shape, bool)
    if "warm" in t:
        m &= (warm >= t["warm"][0]) & (warm <= t["warm"][1])
    if "hue" in t:
        m &= np.any([(h >= lo) & (h <= hi) for lo, hi in t["hue"]], axis=0)
    if "sat" in t:
        m &= (s >= t["sat"][0]) & (s <= t["sat"][1])
    if "light" in t:
        m &= (l >= t["light"][0]) & (l <= t["light"][1])
    return m


def _shapes(shapes: list[dict], shape: tuple[int, int]) -> np.ndarray:
    m = np.zeros(shape, bool)
    for r in shapes:
        m |= region_mask(r, shape) > 0
    return m


def index_map(rgba: np.ndarray, slots: list[dict]) -> tuple[np.ndarray, list[dict], dict]:
    """Canvas-size straight RGBA of a layer -> (uint8 map, R = slot + 1), the rig's slots, figures."""
    shape = rgba.shape[:2]
    h, s, l = hsl(rgba[..., :3])
    warm = rgba[..., 0] - rgba[..., 2]  # red minus blue: skin is warm, silver hair cool or neutral
    alive = rgba[..., 3] > 1.0 / 255.0
    taken = np.zeros(shape, np.uint8)
    for i, slot in enumerate(slots):
        mask = np.zeros(shape, bool)
        for part in slot["parts"]:
            m = alive.copy()
            if "within" in part:
                m &= _shapes(part["within"], shape)
            if "without" in part:
                m &= ~_shapes(part["without"], shape)
            if "colour" in part:
                m &= np.any([_test(t, h, s, l, warm) for t in part["colour"]], axis=0)
            for t in part.get("except", []):
                m &= ~_test(t, h, s, l, warm)
            mask |= m
        mask &= taken == 0
        # Specks out (an isolated pixel recolouring is noise), small gaps closed.
        mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
        mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
        n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= slot.get("minArea", 40)
        mask = keep[lab] & alive & (taken == 0)
        taken[mask] = i + 1
    # Past the alpha edge, the nearest slot (or none) for 4 px.
    ext, dist = nearest_extend(taken.astype(np.float32), alive)
    out = np.where(alive, taken, np.where(dist <= 4, ext, 0)).astype(np.uint8)
    rig_slots, fig = [], {}
    for i, slot in enumerate(slots):
        px = (taken == i + 1) & (rgba[..., 3] > 0.9)
        med = np.median(rgba[..., :3][px], axis=0) if px.any() else np.zeros(3)
        hexv = "#" + "".join(f"{int(round(float(v) * 255)):02x}" for v in med)
        rig_slots.append({"id": slot["id"], "name": slot["name"], "hex": hexv})
        fig[slot["id"]] = {"px": int((taken == i + 1).sum()), "hex": hexv}
    return out, rig_slots, fig
