"""One morph key (design "Builder" steps 2-4): register, gate, support, motion, colour match.

Arrays here are canvas size; the key's cell is cut out by `pack.py`.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .common import dilate, erode, feather, gauss, grey, nblur, pushpull, region_mask, smoothstep
from .register import register

DEFAULT_GATES = {
    "cornerShift": 6.0,  # px a corner of the edit may move under the registration
    "outsideMargin": 3.0,  # /255 over the floor, outside the region prior, inside the figure
    "floorTimes": 3.0,  # support: difference above this many times the floor's local level
    "floorMin": 4.0,  # /255, a lower bound of that level (flat ground and flat anime fills)
    "moves": 0.75,  # px of motion that is support on its own
    "flowSigma": 2.0,  # px, the Gaussian on each DIS field (design: 2)
    "revealTimes": 3.0,  # reveal: key vs warped-back layer above this many floor levels starts...
    "revealRamp": 3.0,  # ...and is full this many levels further on
    "flowFrom": "back",  # "back": F is the inverse of G (one motion, both ways); "forward"; "both"
    "gazeReach": 1.6,  # how far (x the opening's half height) a vertical gaze field may reach: the iris's travel vs the brows
    "weight1": 2.5,  # /255, the render at weight 1 against the key inside its coverage (codec error)
}


FAMILIES = ("joy", "showman", "anger", "gloom", "smug", "suspicion")


def split_parts(k: dict, y_mid: float, band: float) -> list[tuple[str, dict]]:
    """An expression key as two keys that sum to it: `upper` takes the share 1 above the band and
    `lower` the rest (a smoothstep over `band` px about `y_mid`), applied to the coverage, both
    motions and the reveal; the colour is shared."""
    rec = k["record"]
    h, w = k["coverage"].shape
    yy = np.arange(h, dtype=np.float32)[:, None] + 0.5
    up = np.broadcast_to(1.0 - smoothstep(y_mid - band / 2, y_mid + band / 2, yy), (h, w)).astype(np.float32)
    out = []
    for part, share in (("upper", up), ("lower", 1.0 - up)):
        cov = (k["coverage"] * share).astype(np.float32)
        cov = np.where(cov < 1.0 / 255.0, 0.0, cov).astype(np.float32)
        prec = {kk: vv for kk, vv in rec.items() if kk not in ("bbox", "flowMax", "flowP99", "revealMean", "supportPx")}
        prec["id"] = f"{rec['id']}_{part}"
        prec["supportPx"] = int((cov > 0.5).sum())
        pk = {"record": prec, "colour": k["colour"], "coverage": cov, "flow": None, "back": None, "reveal": None}
        reach = cov > 0
        if k["flow"] is not None:
            pk["flow"] = (k["flow"] * share[..., None]).astype(np.float32)
            pk["back"] = (k["back"] * share[..., None]).astype(np.float32)
            pk["reveal"] = (k["reveal"] * share).astype(np.float32)
            reach = reach | (np.abs(pk["flow"]).max(-1) > 0.05) | (np.abs(pk["back"]).max(-1) > 0.05)
        if not reach.any():
            continue
        prec["bbox"] = list(box_of(reach, 0, (h, w)))
        if pk["flow"] is not None:
            x, y, bw, bh = prec["bbox"]
            peak = float(max(np.abs(pk["flow"][y:y + bh, x:x + bw]).max(), np.abs(pk["back"][y:y + bh, x:x + bw]).max()))
            prec["flowMax"] = max(1, int(math.ceil(peak)))
        out.append((part, pk))
    return out


def floor_map(portrait: np.ndarray, noop_reg: np.ndarray) -> np.ndarray:
    """The editor's local noise level: |no-op re-render - portrait|, channel mean, smoothed."""
    return gauss(np.abs(noop_reg - portrait).mean(-1), 6.0)


def _dis(a8: np.ndarray, b8: np.ndarray) -> np.ndarray:
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(1)
    return dis.calc(a8, b8, None)


def _checked(f: np.ndarray, back: np.ndarray) -> np.ndarray:
    """`f` where following it and then `back` returns home (within 1 px + 10 %); elsewhere (an
    occlusion, new teeth, a flat fill with nothing to follow) filled from the consistent pixels."""
    h, w = f.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    ret = cv2.remap(back, gx + f[..., 0], gy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    ok = np.sqrt(((f + ret) ** 2).sum(-1)) < 1.0 + 0.1 * np.sqrt((f ** 2).sum(-1))
    return pushpull(f, ok.astype(np.float32))


def dis_pair(a: np.ndarray, b: np.ndarray, box: tuple[int, int, int, int]) -> tuple[np.ndarray, np.ndarray]:
    """DIS (medium, finest scale 1) on `box` both ways: F (a -> b, in a's frame) and G (b -> a, in
    b's frame), each forward-backward checked; canvas-size output, 0 outside the box."""
    x, y, w, h = box
    ga = np.ascontiguousarray(to8(grey(a[y:y + h, x:x + w])))
    gb = np.ascontiguousarray(to8(grey(b[y:y + h, x:x + w])))
    fab, fba = _dis(ga, gb), _dis(gb, ga)
    out = []
    for f, back in ((fab, fba), (fba, fab)):
        full = np.zeros(a.shape[:2] + (2,), np.float32)
        full[y:y + h, x:x + w] = _checked(f, back)
        out.append(full)
    return out[0], out[1]


GAZE_AXIS = {"gazeL": (-1, 0), "gazeR": (1, 0), "gazeU": (0, -1), "gazeD": (0, 1)}


def iris_flow(a: np.ndarray, b: np.ndarray, eyes: list[list[float]], radius: float, ellipses: list[list[float]], track: str, reach: float = 1.6) -> tuple[np.ndarray, list[list[float]]]:
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
        # The motion stays inside this eye's opening (the recipe's `openings` ellipse nearest the
        # eye: the white and the iris, not the lids), so lashes, brows and cheeks do not travel
        # with the iris; it fades over the opening's outer 15 %.
        ecx, ecy, erx, ery = min(ellipses, key=lambda e: (e[0] - ex) ** 2 + (e[1] - ey) ** 2)
        # Across the motion the field reaches past the lids to hold the whole iris (an anime iris
        # is taller than its opening; a lid line slid along itself does not show).
        if ax:
            ery = max(ery, 1.3 * radius)
        else:
            # A vertical move is along the opening's short axis: the field must hold the iris
            # over its whole travel, or the part beyond the ramp stays behind (a split iris).
            erx = max(erx, 1.3 * radius)
            ery = max(ery, min(1.1 * (radius + abs(dy)), reach * ery))
        m = 1.0 - smoothstep(0.85, 1.0, np.sqrt(((xx - ecx) / erx) ** 2 + ((yy - ecy) / ery) ** 2))
        out[..., 0] += dx * m
        out[..., 1] += dy * m
    return out, moves


def invert_field(g: np.ndarray, steps: int = 30) -> np.ndarray:
    """The field F with x + F(x) = q where q + G(q) = x: F(x) = -G(x + F(x)), iterated (offline,
    so as many steps as it takes; the shader needs no inversion)."""
    h, w = g.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    f = -g.copy()
    for _ in range(steps):
        f = -cv2.remap(g, gx + f[..., 0], gy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0))
    return f.astype(np.float32)


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
    flow, back = dis_pair(portrait, reg, crop)
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
    f = gb = reveal = None
    if kind in ("optical", "iris") and coverage.max() > 0:
        if kind == "iris":
            f, moves = iris_flow(portrait, reg, face["eyes"], face["irisRadius"], face["openings"], spec["track"], g["gazeReach"])
            gb = -f
            rec["irisMove"] = moves
        else:
            f, gb = gauss(flow, g["flowSigma"]), gauss(back, g["flowSigma"])
            if g["flowFrom"] == "back":
                f = invert_field(gb)
            elif g["flowFrom"] == "forward":
                gb = invert_field(f)
        # The key covers its own motion: where a pixel moves, the key's colour is there to meet it
        # (else the moved layer shows through a thin key at weight 1). Then both fields fade to 0
        # with the coverage (F in the layer's frame, G in the key's).
        moving = smoothstep(0.5, 1.5, np.maximum(np.sqrt((f ** 2).sum(-1)), np.sqrt((gb ** 2).sum(-1))))
        moving = feather(dilate(moving > 0.5, 3), 4) * np.maximum(moving, 0.0)
        coverage = np.maximum(coverage, np.clip(moving * 1.5, 0.0, 1.0) * prior * head_alpha).astype(np.float32)
        # ...and to 0 at the head's silhouette: the key takes the layer's alpha, so a motion there
        # would drag the outline (a chin pulled up off the neck).
        keep = coverage * feather(erode(head_alpha > 0.5, 16), 12)
        f = f * keep[..., None]
        gb = gb * keep[..., None]
        f = np.where(np.abs(f) < 0.05, 0.0, f).astype(np.float32)
        gb = np.where(np.abs(gb) < 0.05, 0.0, gb).astype(np.float32)
        reveal = reveal_map(colour, portrait, gb, floor, coverage, g)
    # Where the colour-matched edit is within the editor's noise of the portrait, the key IS the
    # portrait: an editor's faint re-shading round a change (a grey ring round an opened anime
    # mouth) would otherwise show as a halo at the coverage edge.
    snap_level = np.maximum(floor * g["floorTimes"], g["floorMin"] / 255.0)
    near = gauss(np.abs(colour - portrait).mean(-1), 2.0)
    keep_edit = smoothstep(1.0, 2.0, near / snap_level)
    if f is not None:
        # Never where anything moves: there the key's pixel is a moved feature, not a re-shading.
        motion = np.maximum(np.sqrt((f ** 2).sum(-1)), np.sqrt((gb ** 2).sum(-1)))
        keep_edit = np.maximum(keep_edit, smoothstep(0.2, 0.8, motion))
    keep_edit = gauss(keep_edit.astype(np.float32), 2.0)[..., None]
    colour = (keep_edit * colour + (1.0 - keep_edit) * portrait).astype(np.float32)

    if coverage.max() > 0:
        # The box holds the coverage and both motions: a key moves nothing outside it.
        reach = coverage > 0
        if f is not None:
            reach = reach | (np.abs(f).max(-1) > 0) | (np.abs(gb).max(-1) > 0)
        rec["bbox"] = list(box_of(reach, 0, shape))
    if f is not None:
        x, y, w, h = rec["bbox"]
        peak = float(max(np.abs(f[y:y + h, x:x + w]).max(), np.abs(gb[y:y + h, x:x + w]).max()))
        rec["flowMax"] = max(1, int(math.ceil(peak)))
        rec["flowP99"] = round(float(np.percentile(np.sqrt((f[y:y + h, x:x + w] ** 2).sum(-1)), 99)), 3)
        inside = coverage > 0.5
        rec["revealMean"] = round(float(reveal[inside].mean()), 3) if inside.any() else 0.0
    rec["medianMotion"] = round(float(np.median(mag[inner])), 3) if inner.any() else 0.0
    rec["verdict"] = "ok" if not problems else "refused"
    if problems:
        rec["reasons"] = problems
    return {"record": rec, "colour": colour, "coverage": coverage, "flow": f, "back": gb, "reveal": reveal}


def reveal_map(key: np.ndarray, layer: np.ndarray, gb: np.ndarray, floor: np.ndarray, coverage: np.ndarray, g: dict) -> np.ndarray:
    """How much each key pixel is new surface (round 2 amendment): where the key does not match the
    layer pixel its back motion leads to (teeth, the inside of a mouth, a lowered lid), in floor
    levels, smoothed a little, 0 outside the coverage."""
    h, w = key.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    back = cv2.remap(layer, gx + gb[..., 0], gy + gb[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    diff = gauss(np.abs(key - back).mean(-1), 1.0)
    level = np.maximum(floor * g["floorTimes"], g["floorMin"] / 255.0)
    r = np.clip((diff - g["revealTimes"] / g["floorTimes"] * level) / (g["revealRamp"] / g["floorTimes"] * level), 0.0, 1.0)
    return (gauss(r.astype(np.float32), 1.5) * (coverage > 0)).astype(np.float32)
