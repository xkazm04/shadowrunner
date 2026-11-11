"""One morph key (design "Builder" steps 2-4): register, gate, support, motion, colour match.

Arrays here are canvas size; the key's cell is cut out by `pack.py`.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .common import dilate, feather, gauss, grey, nblur, pushpull, region_mask, smoothstep
from .register import register

DEFAULT_GATES = {
    "cornerShift": 6.0,  # px a corner of the edit may move under the registration
    "outsideMargin": 3.0,  # /255 over the floor, outside the region prior, inside the figure
    "floorTimes": 3.0,  # support: difference above this many times the floor's local level
    "floorMin": 4.0,  # /255, a lower bound of that level (flat ground and flat anime fills)
    "moves": 0.75,  # px of motion that is support on its own
    "flowSigma": 6.0,  # px, the Gaussian on the DIS field (design: 2; 6 keeps the field from tearing)
    "invertPx": 0.5,  # px the shader's two-step inversion may miss at weight 1 (99th percentile)
    "weight1": 6.0,  # /255, the render at weight 1 against the key inside its coverage
}


def floor_map(portrait: np.ndarray, noop_reg: np.ndarray) -> np.ndarray:
    """The editor's local noise level: |no-op re-render - portrait|, channel mean, smoothed."""
    return gauss(np.abs(noop_reg - portrait).mean(-1), 6.0)


def dis_flow(a: np.ndarray, b: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """DIS (medium, finest scale 1) from a to b on `box`, canvas-size output (0 outside)."""
    x, y, w, h = box
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(1)
    ga = np.ascontiguousarray(to8(grey(a[y:y + h, x:x + w])))
    gb = np.ascontiguousarray(to8(grey(b[y:y + h, x:x + w])))
    f = dis.calc(ga, gb, None)
    # Forward-backward check: where b -> a does not lead back (an occlusion, new teeth, a flat
    # fill with nothing to follow), the motion is dropped and filled from the consistent pixels.
    back = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    back.setFinestScale(1)
    fb = back.calc(gb, ga, None)
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    ret = cv2.remap(fb, gx + f[..., 0], gy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    err = np.sqrt(((f + ret) ** 2).sum(-1))
    ok = err < 1.0 + 0.1 * np.sqrt((f ** 2).sum(-1))
    f = pushpull(f, ok.astype(np.float32))
    out = np.zeros(a.shape[:2] + (2,), np.float32)
    out[y:y + h, x:x + w] = f
    return out


GAZE_AXIS = {"gazeL": (-1, 0), "gazeR": (1, 0), "gazeU": (0, -1), "gazeD": (0, 1)}


def iris_flow(a: np.ndarray, b: np.ndarray, eyes: list[list[float]], radius: float, ellipses: list[list[float]], track: str) -> tuple[np.ndarray, list[list[float]]]:
    """A gaze key's motion as one translation per eye: the iris disc of `a` found in `b` by
    masked template matching along the track's direction, spread over that eye's opening. DIS
    misses an iris that travels its own width; a translation does not."""
    h, w = a.shape[:2]
    out = np.zeros((h, w, 2), np.float32)
    moves = []
    r = int(round(radius))
    s = int(round(radius * 2.5))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    for i, (ex, ey) in enumerate(eyes):
        cx, cy = int(round(ex)), int(round(ey))
        # The portrait's iris (a disc about the eye centre, in colour) found in the edit.
        tpl = np.ascontiguousarray(a[cy - r:cy + r + 1, cx - r:cx + r + 1])
        win = np.ascontiguousarray(b[cy - r - s:cy + r + s + 1, cx - r - s:cx + r + s + 1])
        mask = np.repeat(disc[..., None], 3, axis=2).astype(np.float32)
        res = cv2.matchTemplate(win, tpl, cv2.TM_SQDIFF, mask=mask)
        # Search only along the track's direction (gazeL moves left, never right), a third of a
        # radius across it: an eyeliner wing or a lash line is otherwise as dark as an iris.
        ax, ay = GAZE_AXIS[track]
        oy, ox = np.mgrid[0:res.shape[0], 0:res.shape[1]] - s
        across = r / 3.0
        allowed = ((ox * ax >= -2) & (np.abs(oy) <= across)) if ax else ((oy * ay >= -2) & (np.abs(ox) <= across))
        res = np.where(allowed, res, res.max() * 2.0).astype(np.float32)
        _, _, loc, _ = cv2.minMaxLoc(res)
        px, py = loc
        dx, dy = float(px - s), float(py - s)
        if 0 < px < res.shape[1] - 1:
            l, c, rr = res[py, px - 1], res[py, px], res[py, px + 1]
            den = l - 2 * c + rr
            dx += 0.5 * (l - rr) / den if den > 1e-9 else 0.0
        if 0 < py < res.shape[0] - 1:
            u, c, d = res[py - 1, px], res[py, px], res[py + 1, px]
            den = u - 2 * c + d
            dy += 0.5 * (u - d) / den if den > 1e-9 else 0.0
        moves.append([round(float(dx), 2), round(float(dy), 2)])
        # The motion stays inside this eye's opening (the region's ellipse nearest the eye), so
        # brows and cheeks do not travel with the iris. Along the motion it ramps over most of the
        # opening (gentle, so the shader's fixed point holds); across it, it may stop short.
        ecx, ecy, erx, ery = min(ellipses, key=lambda e: (e[0] - ex) ** 2 + (e[1] - ey) ** 2)
        u, v = np.abs(xx - ecx) / erx, np.abs(yy - ecy) / ery
        along, across = (u, v) if ax else (v, u)
        m = (1.0 - smoothstep(0.15, 1.0, along)) * (1.0 - smoothstep(0.55, 0.95, across))
        out[..., 0] += dx * m
        out[..., 1] += dy * m
    return out, moves


def inversion_miss(f: np.ndarray, inside: np.ndarray, s: float) -> float:
    """99th percentile px by which p = x - D(x - D(x)) misses p + D(p) = x, D = s f."""
    h, w = f.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    d = (f * s).astype(np.float32)

    def at(px: np.ndarray, py: np.ndarray) -> np.ndarray:
        return cv2.remap(d, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0))

    d0 = d
    d1 = at(gx - d0[..., 0], gy - d0[..., 1])
    px, py = gx - d1[..., 0], gy - d1[..., 1]
    d2 = at(px, py)
    miss = np.sqrt((px + d2[..., 0] - gx) ** 2 + (py + d2[..., 1] - gy) ** 2)
    return float(np.percentile(miss[inside], 99)) if inside.any() else 0.0


def inversion_scale(f: np.ndarray, inside: np.ndarray, limit: float) -> tuple[float, float]:
    """The largest scale in (0, 1] (to 1/64) whose inversion misses by at most `limit` px."""
    full = inversion_miss(f, inside, 1.0)
    if full <= limit:
        return 1.0, full
    lo, hi = 0.0, 1.0
    for _ in range(6):
        mid = (lo + hi) / 2
        if inversion_miss(f, inside, mid) <= limit:
            lo = mid
        else:
            hi = mid
    return lo, inversion_miss(f, inside, lo)


def to8(img: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(img * 255.0), 0, 255).astype(np.uint8)


def box_of(mask: np.ndarray, pad: int, shape: tuple[int, int]) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    h, w = shape
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(w, int(xs.max()) + 1 + pad), min(h, int(ys.max()) + 1 + pad)
    return x0, y0, x1 - x0, y1 - y0


def build_key(spec: dict, portrait: np.ndarray, edit: np.ndarray, noop_reg: np.ndarray, floor: np.ndarray,
              head_alpha: np.ndarray, figure: np.ndarray, region: dict, gates: dict, face: dict) -> dict:
    """Everything about one key: the record for the report and, when it passes, the arrays."""
    g = {**DEFAULT_GATES, **gates}
    shape = portrait.shape[:2]
    prior_bin = region_mask(region, shape)
    prior = feather(prior_bin, 10)
    outside = (figure > 0.5) & (dilate(prior_bin > 0, 12) == 0)
    reg, warp, shift = register(portrait, edit, (dilate(prior_bin > 0, 30) == 0).astype(np.float32))

    diff_key = np.abs(reg - portrait).mean(-1)
    diff_noop = np.abs(noop_reg - portrait).mean(-1)
    floor_out = float(diff_noop[outside].mean() * 255)
    out_diff = float(diff_key[outside].mean() * 255)
    rec: dict = {
        "id": spec["id"],
        "edit": spec["edit"],
        "affine": [[round(float(v), 5) for v in row] for row in warp],
        "cornerShift": round(shift, 3),
        "floor": round(floor_out, 3),
        "outsidePrior": round(out_diff, 3),
    }
    problems = []
    if shift > g["cornerShift"]:
        problems.append(f"the registration moves a corner {shift:.2f} px (gate {g['cornerShift']})")
    if out_diff > floor_out + g["outsideMargin"]:
        problems.append(f"the edit changed the picture outside its region by {out_diff:.2f}/255 (floor {floor_out:.2f} + {g['outsideMargin']})")

    crop = box_of(dilate(prior_bin > 0, 24), 0, shape)
    flow = dis_flow(portrait, reg, crop)
    mag = np.sqrt((flow ** 2).sum(-1))
    level = np.maximum(floor * g["floorTimes"], g["floorMin"] / 255.0)
    changed = gauss(diff_key, 1.5) > level
    moved = gauss(mag, 2.0) > g["moves"]
    seed = (changed | moved) & (prior_bin > 0)
    seed = cv2.morphologyEx(seed.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    coverage = feather(dilate(seed, 10), 8) * prior * head_alpha
    coverage = np.where(coverage < 1.0 / 255.0, 0.0, coverage).astype(np.float32)
    support = int((coverage > 0.5).sum())
    rec["supportPx"] = support
    if support < 50:
        problems.append(f"the edit changed almost nothing inside its region ({support} px)")

    # Colour match: the low-frequency residual outside the support, extended across it.
    away = (~dilate(coverage > 0, 6)) & (head_alpha > 0.5)
    resid, wsum = nblur(portrait - reg, away.astype(np.float32), 12.0)
    resid = pushpull(resid, np.clip(wsum * 4.0, 0.0, 1.0))
    colour = np.clip(reg + resid, 0.0, 1.0).astype(np.float32)
    inner = coverage > 0.5
    rec["colourShift"] = round(float(np.abs(resid[inner]).mean() * 255), 3) if inner.any() else 0.0

    kind = spec.get("flow", "none")
    f = None
    if kind in ("optical", "iris") and coverage.max() > 0:
        if kind == "iris":
            f, moves = iris_flow(portrait, reg, face["eyes"], face["irisRadius"], region["ellipses"], spec["track"])
            f = f * head_alpha[..., None]
            rec["irisMove"] = moves
        else:
            f = gauss(flow, g["flowSigma"]) * coverage[..., None]
            f = gauss(f, 2.0)
        f = np.where(np.abs(f) < 0.05, 0.0, f).astype(np.float32)
    if coverage.max() > 0:
        # The box holds the coverage and the motion: a key moves nothing outside it.
        reach = (coverage > 0) | ((np.abs(f).max(-1) > 0) if f is not None else False)
        rec["bbox"] = list(box_of(reach, 0, shape))
    if f is not None:
        x, y, w, h = rec["bbox"]
        # The shader inverts the field by two fixed-point steps (p = x - D(p)): exact only while
        # the field is gentle. The field is scaled down until the two steps land within
        # `invertPx` (99th percentile); a gentler field still shows every key exactly at weight 1,
        # because the key is read where the pixel lands.
        scale, resid = inversion_scale(f[y:y + h, x:x + w], coverage[y:y + h, x:x + w] > 0.5, g["invertPx"])
        rec["flowInvert"] = round(resid, 3)
        if scale < 1.0:
            f = f * scale
            rec["flowScaled"] = round(scale, 3)
        peak = float(np.abs(f[y:y + h, x:x + w]).max())
        rec["flowMax"] = max(1, int(math.ceil(peak)))
        rec["flowP99"] = round(float(np.percentile(np.sqrt((f[y:y + h, x:x + w] ** 2).sum(-1)), 99)), 3)
    rec["medianMotion"] = round(float(np.median(mag[inner])), 3) if inner.any() else 0.0
    rec["verdict"] = "ok" if not problems else "refused"
    if problems:
        rec["reasons"] = problems
    return {"record": rec, "colour": colour, "coverage": coverage, "flow": f}
