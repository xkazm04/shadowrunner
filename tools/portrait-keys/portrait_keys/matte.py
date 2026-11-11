"""Mattes (design "Builder" step 1): soft alpha from the green-screen edits, colour from the
portrait's own pixels un-mixed against its ground, and the three layers.

Alpha never comes from luma: Iris's black headset and dark roots sit on a charcoal ground. It comes
from the `matte` (figure) and `head` edits, where the editor replaced everything else with #00FF00.
"""
from __future__ import annotations

import cv2
import numpy as np

from .common import dilate, distance_from, erode, feather, gauss, nblur, pushpull, smoothstep
from .register import register


def key_colour(edit: np.ndarray) -> np.ndarray:
    """The edit's green, as the median of a 24 px frame round the picture."""
    b = 24
    frame = np.concatenate([edit[:b].reshape(-1, 3), edit[-b:].reshape(-1, 3), edit[:, :b].reshape(-1, 3), edit[:, -b:].reshape(-1, 3)])
    return np.median(frame, axis=0).astype(np.float32)


def chroma_alpha(edit: np.ndarray, key: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Soft alpha of an edit over `key`. A first guess from green dominance (G - max(R, B)), then a
    projection onto the line from the key to the local foreground colour (the nearest solid pixels),
    so a pink strand over green is as soft as a grey one. `lo`/`hi` clip the noise at both ends."""
    gd = edit[..., 1] - np.maximum(edit[..., 0], edit[..., 2])
    kd = float(key[1] - max(key[0], key[2]))
    a0 = 1.0 - np.clip(gd / kd, 0.0, 1.0)
    solid = erode(a0 > 0.97, 1)
    fg = pushpull(edit, solid.astype(np.float32))
    d = key[None, None, :] - fg
    n2 = (d * d).sum(-1)
    t = ((key[None, None, :] - edit) * d).sum(-1) / np.maximum(n2, 1e-6)
    a1 = np.clip(t, 0.0, 1.0)  # edit = a fg + (1 - a) key  =>  key - edit = a (key - fg)
    # A foreground close to the key (Bun's mint drawstrings) cannot be projected: keep the first guess.
    trust = smoothstep(0.15, 0.35, np.sqrt(n2))
    a = trust * a1 + (1.0 - trust) * a0
    return np.clip((a - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def fill_pockets(alpha: np.ndarray, portrait: np.ndarray, ground: np.ndarray, core_px: int) -> np.ndarray:
    """Holes inside the figure (a keyed-out colour near green, an editor smudge) become solid unless
    the portrait shows its ground there too (a real gap between strands)."""
    low = (alpha < 0.5).astype(np.uint8)
    n, labels = cv2.connectedComponents(low, connectivity=4)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
    outside = np.isin(labels, list(border)) & (low > 0)
    core = distance_from(outside) > core_px
    groundlike = np.clip(1.0 - np.abs(portrait - ground).max(-1) / 0.10, 0.0, 1.0)
    return np.where(core, np.maximum(alpha, 1.0 - groundlike), alpha).astype(np.float32)


def ground_check(alpha: np.ndarray, portrait: np.ndarray, ground: np.ndarray) -> tuple[np.ndarray, float]:
    """Where the portrait itself can tell figure from ground (a pink strand on sky blue, silver hair
    on charcoal), the edit's alpha may not exceed what the portrait shows: an editor that painted
    over a gap between strands would otherwise leave the ground's colour inside the layer. Trusted
    only where the foreground is far from the ground and the pixel lies on the line between them
    (not on a dark outline, not on a black headset against charcoal). Returns the share it lowered."""
    solid = erode(alpha > 0.97, 2)
    fg = pushpull(portrait, solid.astype(np.float32))
    d = fg - ground
    n2 = (d * d).sum(-1)
    t = np.clip(((portrait - ground) * d).sum(-1) / np.maximum(n2, 1e-6), 0.0, 1.0)
    resid = np.sqrt(((portrait - (t[..., None] * fg + (1.0 - t[..., None]) * ground)) ** 2).sum(-1))
    w = smoothstep(0.2, 0.4, np.sqrt(n2)) * (1.0 - smoothstep(0.05, 0.12, resid))
    out = (1.0 - w) * alpha + w * np.minimum(alpha, t)
    lowered = float(((alpha - out) > 0.1).sum() / max(1, int((alpha > 0.01).sum())))
    return out.astype(np.float32), lowered


def nearest_extend(values: np.ndarray, known: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each pixel takes the value of the nearest known pixel; also the distance to it."""
    dist, labels = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(known)
    table = np.zeros(int(labels.max()) + 1, np.float32)
    table[labels[ys, xs]] = values[ys, xs]
    return table[labels], dist


def estimate_ground(portrait: np.ndarray, figure: np.ndarray) -> np.ndarray:
    """The portrait's ground, smooth, extended under the figure."""
    outside = ~dilate(figure > 0.01, 8)
    smooth, w = nblur(portrait, outside.astype(np.float32), 6.0)
    return pushpull(smooth, (outside & (w > 0.5)).astype(np.float32))


def unmix(img: np.ndarray, alpha: np.ndarray, behind: np.ndarray, solid: float = 0.7) -> np.ndarray:
    """The foreground colour F of `img = a F + (1 - a) behind`. Where alpha is low the solve is
    noise over a, so it leans on the nearest solid colour; under alpha 0 it is that colour."""
    a = alpha[..., None]
    f = np.clip((img - (1.0 - a) * behind) / np.maximum(a, 1e-3), 0.0, 1.0)
    ext = pushpull(f, (alpha > solid).astype(np.float32))
    c = np.clip(alpha / 0.35, 0.0, 1.0)[..., None]
    return np.where(a > 0, c * f + (1.0 - c) * ext, ext).astype(np.float32)


def layers(portrait: np.ndarray, matte_edit: np.ndarray, head_edit: np.ndarray, cfg: dict) -> dict:
    """The background, body and head layers (canvas size, straight alpha) and the figures."""
    lo, hi = cfg.get("lo", 0.04), cfg.get("hi", 0.96)
    out: dict = {"figures": {}}

    def keyed(edit: np.ndarray, name: str) -> tuple[np.ndarray, np.ndarray]:
        key = key_colour(edit)
        rough = chroma_alpha(edit, key, lo, hi)
        mask = erode(rough > 0.5, 12)
        reg, warp, shift = register(portrait, edit, mask)
        out["figures"][name] = {"key": [round(float(v) * 255, 1) for v in key], "affine": np.round(warp, 5).tolist(), "cornerShift": round(shift, 3)}
        return chroma_alpha(reg, key, lo, hi), reg

    fig, _ = keyed(matte_edit, "figure")
    head0, _ = keyed(head_edit, "head")
    ground = estimate_ground(portrait, fig)
    fig = fill_pockets(fig, portrait, ground, cfg.get("core", 8))
    if cfg.get("groundCheck", True):
        fig, lowered = ground_check(fig, portrait, ground)
        out["figures"]["groundCheckLowered"] = round(lowered, 4)
    head0 = fill_pockets(head0, portrait, ground, cfg.get("core", 8)) * (fig > 0.01)

    # Head or body: near the body (neck, collar, hair over the clothes) the head edit splits the
    # figure; away from it (hair, ears, headgear over the ground) the figure's alpha is the head's.
    body_solid = erode((fig > 0.9) & (head0 < 0.1), 2)
    near_body = feather(dilate(body_solid, cfg.get("nearBody", 16)), 8)
    head_a = near_body * np.minimum(fig, head0) + (1.0 - near_body) * fig
    head_a = np.where(head_a < 1.0 / 255.0, 0.0, head_a).astype(np.float32)
    body_raw = np.clip((fig - head_a) / np.maximum(1.0 - head_a, 1e-3), 0.0, 1.0)
    body_raw = np.where(head_a > 0.98, 0.0, body_raw) * near_body
    body_raw = np.clip((body_raw - 0.1) / 0.9, 0.0, 1.0)

    # The body under the head: its own alpha pushed inward from where it shows, fading out over
    # `under` px, so a moving head uncovers neck and collar, never a hole.
    under = float(cfg.get("under", 40))
    shows = head_a < 0.5
    ext_a, depth = nearest_extend(body_raw, shows)
    ext_a = gauss(ext_a, 3.0)
    hidden = smoothstep(0.2, 0.8, head_a)
    body_a = ((1.0 - hidden) * body_raw + hidden * ext_a * np.clip(1.0 - depth / under, 0.0, 1.0)).astype(np.float32)
    body_a = np.where(body_a < 1.0 / 255.0, 0.0, body_a).astype(np.float32)

    body_known = (head_a < 0.05)
    body_rgb = unmix(portrait, np.where(body_known, body_raw, 0.0).astype(np.float32), ground)
    behind = body_a[..., None] * body_rgb + (1.0 - body_a[..., None]) * ground
    head_rgb = unmix(portrait, head_a, behind)

    figure_zone = feather(dilate(fig > 0.01, 6), 6)[..., None]
    background = figure_zone * ground + (1.0 - figure_zone) * portrait

    recomposed = head_a[..., None] * head_rgb + (1.0 - head_a[..., None]) * behind
    inside = fig > 0.01
    err = np.abs(recomposed - portrait).mean(-1)
    out["figures"]["recomposeMeanAbs"] = round(float(err[inside].mean() * 255), 3)
    out["figures"]["recomposeP99"] = round(float(np.percentile(err[inside], 99) * 255), 2)
    out["figures"]["groundRgb"] = [round(float(v) * 255, 1) for v in np.median(ground.reshape(-1, 3), 0)]
    out.update(figure=fig, head=np.dstack([head_rgb, head_a]), body=np.dstack([body_rgb, body_a]), background=background, ground=ground)
    return out

