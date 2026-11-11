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

A slot with `soft` (companion-lanes round 5; `soft: { band?, sigma?, dead? }` or true) also gets a
coverage, written to the map's G (the rig's `regions.soft`): a strand tip over skin is part hair,
and no colour threshold separates it from skin. About the slot's binary edge, `band` px each side,
each pixel is unmixed between the slot's local colour and the local colour of what lies outside
it (each a Gaussian-weighted mean, `sigma` px, of pixels clearly inside / clearly outside, carried
to where none are near): its chroma (rgb minus its mean, so shading does not count) projected onto
the segment between the two, then mapped through the dead zone `dead` = [lo, hi] -> 0..1, so skin
reads 0 and the pure slot 1. Outside the binary edge it fades to 0 over the band's outer half and
only claims free pixels its parts' shapes allow (`within`, `without`); inside it rises to 1 at `band` px deep. Every other slot of a soft layer
(and every slot of a layer with no soft slot, whose map stays one channel) has coverage 255.
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


def _places(slot: dict, shape: tuple[int, int]) -> np.ndarray:
    """Where a slot's parts may reach by shape alone (`within`, `without`; colour tests ignored)."""
    m = np.zeros(shape, bool)
    for part in slot["parts"]:
        p = _shapes(part["within"], shape) if "within" in part else np.ones(shape, bool)
        if "without" in part:
            p &= ~_shapes(part["without"], shape)
        m |= p
    return m


def _local_mean(values: np.ndarray, known: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian-weighted mean of `values` over `known` pixels, carried to the nearest where none are near."""
    w = known.astype(np.float32)
    den = cv2.GaussianBlur(w, (0, 0), sigma)
    num = np.stack([cv2.GaussianBlur(values[..., c] * w, (0, 0), sigma) for c in range(values.shape[-1])], -1)
    good = den > 0.02
    mean = num / np.maximum(den, 1e-6)[..., None]
    if not good.any():
        return mean
    return np.stack([nearest_extend(mean[..., c], good)[0] for c in range(values.shape[-1])], -1)


def soft_coverage(rgb: np.ndarray, alive: np.ndarray, mask: np.ndarray, free: np.ndarray, opts: dict) -> tuple[np.ndarray, np.ndarray]:
    """(coverage 0..1, the pixels the slot claims) of a soft slot whose binary mask is `mask`."""
    band = float(opts.get("band", 24))
    sigma = float(opts.get("sigma", band))
    lo, hi = opts.get("dead", [0.2, 0.8])
    d_out = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5)
    d_in = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    chroma = (rgb - rgb.mean(-1, keepdims=True)).astype(np.float32)
    inner = _local_mean(chroma, mask & (d_in > 2), sigma)
    outer = _local_mean(chroma, alive & ~mask & (d_out > 0.75 * band), sigma)
    seg = inner - outer
    n2 = (seg * seg).sum(-1)
    t = ((chroma - outer) * seg).sum(-1) / np.maximum(n2, 1e-6)
    t = np.clip((t - lo) / (hi - lo), 0, 1)
    t = np.where(n2 > 0.02 ** 2, t, mask.astype(np.float32))  # no colour step to unmix: binary
    rise = np.clip(d_in / band, 0, 1)
    fade = np.clip(2 - 2 * d_out / band, 0, 1)
    cover = np.where(mask, np.maximum(t, rise), t * fade)
    # Pockets: a free pixel between two of the slot's pixels on its row, closer than `pocket` px (a
    # strand tip's notch, whose colour is the skin seen through it): 1 under half that gap, falling
    # to 0 at `pocket`, so a notch tapers to its open end; smoothed so the rows make no stairs. It
    # also floors the slot's own pixels, so a thin strand between two notches is not left behind.
    width = float(opts.get("pocket", 0))
    if width >= 4:
        idx = np.arange(mask.shape[1], dtype=np.float32)[None, :]
        left = np.maximum.accumulate(np.where(mask, idx, -1e6), axis=1)
        right = np.minimum.accumulate(np.where(mask, idx, 1e6)[:, ::-1], axis=1)[:, ::-1]
        gap = right - left
        pocket = np.clip(2 - 2 * gap / width, 0, 1).astype(np.float32)
        if "pocketWithin" in opts:
            pocket = np.where(_shapes(opts["pocketWithin"], mask.shape), pocket, 0).astype(np.float32)
        pocket = cv2.GaussianBlur(pocket, (0, 0), 1.5)  # the slot's own pixels count 1 (gap 0)
        cover = np.maximum(cover, pocket)
    claim = mask | (free & alive & (cover > 0.5 / 255))
    return np.where(claim, cover, 0).astype(np.float32), claim


def index_map(rgba: np.ndarray, slots: list[dict]) -> tuple[np.ndarray, list[dict], dict]:
    """Canvas-size straight RGBA of a layer -> (uint8 map, R = slot + 1, G = coverage on a soft layer),
    the rig's slots, figures."""
    shape = rgba.shape[:2]
    h, s, l = hsl(rgba[..., :3])
    warm = rgba[..., 0] - rgba[..., 2]  # red minus blue: skin is warm, silver hair cool or neutral
    alive = rgba[..., 3] > 1.0 / 255.0
    taken = np.zeros(shape, np.uint8)
    masks: list[np.ndarray] = []
    fig: dict = {}
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
        masks.append(mask)
    # Soft slots (round 5): coverage about the binary edge; a slot may claim free pixels past it.
    soft = any("soft" in slot for slot in slots)
    labels = taken.copy()
    cover = np.where(taken > 0, 1.0, 0.0).astype(np.float32)
    for i, slot in enumerate(slots):
        if "soft" not in slot:
            continue
        opts = slot["soft"] if isinstance(slot["soft"], dict) else {}
        c, claim = soft_coverage(rgba[..., :3], alive, masks[i], (labels == 0) & _places(slot, shape), opts)
        labels[claim] = i + 1
        cover[claim] = c[claim]
        fig.setdefault("soft", {})[slot["id"]] = {"claimed": int((claim & ~masks[i]).sum()), "partial": int((claim & (c < 1)).sum())}
    # Past the alpha edge, the nearest slot (or none) for 4 px.
    ext, dist = nearest_extend(labels.astype(np.float32), alive)
    out = np.where(alive, labels, np.where(dist <= 4, ext, 0)).astype(np.uint8)
    if soft:
        ext_c, _ = nearest_extend(cover, alive)
        g = np.round(np.clip(np.where(alive, cover, ext_c), 0, 1) * 255).astype(np.uint8)
        g = np.where(out > 0, g, 0).astype(np.uint8)
        out = np.stack([out, g, np.zeros_like(out)], -1)
    rig_slots = []
    for i, slot in enumerate(slots):
        px = (taken == i + 1) & (rgba[..., 3] > 0.9)
        med = np.median(rgba[..., :3][px], axis=0) if px.any() else np.zeros(3)
        hexv = "#" + "".join(f"{int(round(float(v) * 255)):02x}" for v in med)
        rig_slot = {"id": slot["id"], "name": slot["name"], "hex": hexv}
        if "shade" in slot:
            rig_slot["shade"] = slot["shade"]  # round 4: "move" = the recolour maps lightness too
        rig_slots.append(rig_slot)
        fig[slot["id"]] = {"px": int((taken == i + 1).sum()), "hex": hexv}
    return out, rig_slots, fig
