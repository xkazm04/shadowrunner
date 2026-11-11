"""A blink key's motion as a lid that slides (round 4, `flow: "lid"`): per eye and per column the
upper lash line of the portrait found in the edit (a column template of the lash band matched
downward), and the lid above it stretched down to meet it; below the new lash line nothing moves.

Between two blink stops both keys then move the lid by their own measured travel, so the lash
lines of the two keys land on one line (a slide), where a cross-fade or a smoothed optical field
shows two lids. The field is the back field G (key frame); F is its inverse (keys.invert_field).
"""
from __future__ import annotations

import numpy as np

from .common import gauss, grey


def lash_lines(a: np.ndarray, b: np.ndarray, opening: list[float], lift: float, band: int = 10,
               search: float = 2.2) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For each column of one eye's opening: the portrait's upper lash line (darkest row of the
    upper half, `lift` x ry above the centre to the centre), and its travel down in the edit (SSD
    of the column band [lash - band, lash + band/2] over shifts 0 .. search x ry). Returns the
    columns, the lash rows and the travel (smoothed across columns, never negative)."""
    cx, cy, rx, ry = opening
    ga, gb = gauss(grey(a), 1.0), gauss(grey(b), 1.0)
    xs = np.arange(int(cx - rx * 1.05), int(cx + rx * 1.05) + 1)
    top, mid = int(cy - lift * ry), int(cy)
    lash = np.array([top + int(np.argmin(ga[top:mid, x])) for x in xs], np.float32)
    lash = np.round(gauss(lash[None, :], 3.0)[0]).astype(int)
    smax = int(search * ry)
    travel = np.zeros(len(xs), np.float32)
    cost = np.zeros((len(xs), smax + 1), np.float32)
    for i, x in enumerate(xs):
        y0, y1 = lash[i] - band, lash[i] + band // 2
        tpl = ga[y0:y1, x - 1:x + 2]
        for s in range(smax + 1):
            cost[i, s] = float(((gb[y0 + s:y1 + s, x - 1:x + 2] - tpl) ** 2).sum())
    # Neighbouring columns vote (a lash line is continuous): cost smoothed across columns.
    cost = np.apply_along_axis(lambda c: np.convolve(c, np.ones(9) / 9, mode="same"), 0, cost)
    for i in range(len(xs)):
        s = int(np.argmin(cost[i]))
        if 0 < s < smax:
            l, c, r = cost[i, s - 1], cost[i, s], cost[i, s + 1]
            den = l - 2 * c + r
            travel[i] = s + (0.5 * (l - r) / den if den > 1e-12 else 0.0)
        else:
            travel[i] = s
    # One column's mismatch (a strand, a lash tip) is an outlier: a running median, then smooth.
    travel = np.array([np.median(travel[max(0, i - 6):i + 7]) for i in range(len(travel))], np.float32)
    travel = np.maximum(0.0, gauss(travel[None, :], 4.0)[0])
    return xs, lash.astype(np.float32), travel


def lid_back(a: np.ndarray, b: np.ndarray, openings: list[list[float]], lift: float = 1.3,
             reach: float = 1.6, search: float = 2.2, low: float = 1.05,
             hold: float = 0.7) -> tuple[np.ndarray, list[dict]]:
    """The back field G (key frame -> layer) of a lid that slides, as one monotone remap per column
    with no fold: the lid's top (`reach` x ry above the portrait's lash line) and the lower lash
    (`low` x ry below the opening's centre) stay; the lash line moves down by its travel, the lid
    above it stretches and the open eye below it is pressed into what is left. A fold (the lid
    simply covering the eye) is exact for one key but tears when two stops mix their fields; the
    pressed eye is covered by the key's own colour (reveal brings it in early). Below the new
    lash the eye first moves with it (`hold` of what is left), then is pressed.
    The travel fades to 0 over the outer 20 % of the opening's width (the eye corners)."""
    h, w = a.shape[:2]
    g = np.zeros((h, w, 2), np.float32)
    info = []
    for op in openings:
        cx, cy, rx, ry = op
        xs, lash, travel = lash_lines(a, b, op, lift, search=search)
        u = np.abs(xs - cx) / (rx * 1.05)
        travel = travel * (1.0 - np.clip((u - 0.8) / 0.2, 0.0, 1.0))
        bottom = cy + low * ry
        info.append({"travel": round(float(travel.max()), 2), "lash": [round(float(lash.min()), 1), round(float(lash.max()), 1)]})
        for x, l0, d in zip(xs, lash, travel):
            if d < 0.05 or l0 >= bottom - 4:
                continue
            top = l0 - reach * ry
            new = min(l0 + d, bottom - 3.0)
            ys = np.arange(int(np.floor(top)), int(np.ceil(bottom)) + 1)
            q = ys + 0.5
            # Below the new lash the eye first moves with it (a translation over `hold` of what is
            # left), then is pressed: two stops then agree near the lash, where the shader reads
            # each key's field at the mixed point, not at its own.
            mid = new + hold * (bottom - new)
            src = np.interp(q, [top, new, mid, bottom], [top, l0, l0 + (mid - new), bottom])
            g[ys, x, 1] = np.where((q >= top) & (q <= bottom), src - q, 0.0)
    return g, info
