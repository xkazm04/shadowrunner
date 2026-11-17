"""Per-frame hand check (spec iris-hands, round 2 item 5): is every visible hand a plausible hand?

Input: MediaPipe's 21 landmarks per hand (handscan.py), in image pixels and in world metres
(hand-centred 3D). 0 = wrist; thumb 1-4 (CMC, MCP, IP, tip); index 5-8, middle 9-12, ring 13-16,
pinky 17-20 (MCP, PIP, DIP, tip). A visible hand is flagged when:

- conf:   MediaPipe's handedness score falls (the model is unsure it is looking at a hand);
- bones:  a phalanx collapses to a stub or stretches past any hand, against the palm (wrist to
          middle MCP);
- shape:  the five-finger structure breaks: adjacent knuckles fuse or tear apart across the palm;
- jump:   the hand changes shape between frames beyond its own motion (the residual after the best
          similarity fit of the previous frame's landmarks onto this frame's, against hand size);
- faded:  the hand turns translucent (the jacket shows through: the luminance under its landmarks
          falls well below the hand's own median);
- lost:   a hand that was seen goes missing while its last position is well inside the frame
          (smeared, melted into the sleeve, or dissolved), for as long as it stays missing, unless
          its last box meets the other hand's (clasped: hidden behind it, MediaPipe sees one hand).

Clasped hands (both found and overlapping, or one found over the other's last box) are not judged:
interlaced fingers turn every signal above into noise (clasped hands that look right score
0.93-0.96, jitter, and put landmarks on the dark gaps between fingers). A frame where every hand is clasped is not a
hand frame.

A take scores the share of hand frames (frames with at least one judged hand) with no flag, and
its worst 0.5 s window (the lowest such share over 13 consecutive frames holding at least 6 hand
frames).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FPS = 25
FINGERS = {"index": (5, 6, 7, 8), "middle": (9, 10, 11, 12), "ring": (13, 14, 15, 16),
           "pinky": (17, 18, 19, 20)}
KNUCKLES = (5, 9, 13, 17)
WINDOW = 13            # 0.5 s at 25 fps

# Thresholds, calibrated in round 2 on one clip (emv3-c8g: frames 0-60 judged good by eye, the
# right hand's collapse at frames 113-124 judged bad) and then checked on the other round-1 clips.
# MediaPipe fits a plausible skeleton to almost anything, so its world-landmark proportions shift
# with the view (a turned hand moves a phalanx ratio by 2-3x): good back-of-hand views put the ring
# proximal phalanx at 0.02-0.04 of the palm and swap the knuckle order (SA and emv3 rest poses,
# judged good by eye). So only gross geometry is flagged and the knuckle order is not used; the
# discriminating signals are the score, the shape jump, translucency and the lost hand.
CONF_MIN = 0.96              # handedness score: c8g good stretch >= 0.97, the collapsed hand 0.93-0.957
BONE_RANGE = (0.01, 0.75)    # any phalanx / palm length (all round-1 hands: min 0.01, max 0.65)
KNUCKLE_GAP = (0.02, 0.60)   # adjacent knuckle spacing / palm length (fused or torn-apart knuckles)
JUMP_MAX = 0.09              # similarity-fit residual RMS / 2D hand size (c8g good motion p50 0.01)
FADE = 0.70                  # luminance under the landmarks below this share of the track's median:
                             # a translucent (ghost) hand with the jacket showing through
EDGE = 0.03                  # a hand last seen this far (share of width) inside the frame that then
                             # disappears has melted away, not left the frame


@dataclass
class Hand:
    xy: np.ndarray       # (21, 2) image pixels
    world: np.ndarray    # (21, 3) metres, hand-centred
    score: float         # handedness score
    label: str = ""
    lum: float = float("nan")  # median luminance (0-255) sampled under the 21 landmarks


@dataclass
class FrameCheck:
    hands: int = 0                                     # judged hands (found + lost)
    clasped: int = 0                                   # hands not judged: clasped together
    flags: list[str] = field(default_factory=list)     # "<track>:<kind>[:detail]"

    @property
    def good(self) -> bool:
        return not self.flags


def palm_frame(w: np.ndarray) -> tuple[float, np.ndarray]:
    """Palm length (wrist to middle MCP) and the palm normal (wrist, index MCP, pinky MCP)."""
    palm = float(np.linalg.norm(w[9] - w[0]))
    n = np.cross(w[5] - w[0], w[17] - w[0])
    return palm, n / (np.linalg.norm(n) + 1e-9)


def bone_flags(w: np.ndarray) -> list[str]:
    """A phalanx collapsed to a stub or stretched past any hand, against the palm length."""
    palm, _ = palm_frame(w)
    if palm <= 1e-6:
        return ["bones:palm0"]
    out = []
    for name, (mcp, pip, dip, tip) in FINGERS.items():
        for k, (a, b) in enumerate(((mcp, pip), (pip, dip), (dip, tip))):
            r = float(np.linalg.norm(w[b] - w[a])) / palm
            if not BONE_RANGE[0] <= r <= BONE_RANGE[1]:
                out.append(f"bones:{name}{k + 1}={r:.2f}")
    return out


def shape_flags(w: np.ndarray) -> list[str]:
    """The five-finger structure: the four knuckles keep a plausible spacing across the palm."""
    out = []
    palm, _ = palm_frame(w)
    gaps = [float(np.linalg.norm(w[b] - w[a])) / max(palm, 1e-6) for a, b in zip(KNUCKLES, KNUCKLES[1:])]
    for k, g in enumerate(gaps):
        if not KNUCKLE_GAP[0] <= g <= KNUCKLE_GAP[1]:
            out.append(f"shape:knuckles{k}={g:.2f}")
    return out


def hand_size(xy: np.ndarray) -> float:
    """2D hand size: the larger side of the landmark box."""
    span = xy.max(0) - xy.min(0)
    return float(max(span[0], span[1], 1.0))


def fit_residual(prev: np.ndarray, cur: np.ndarray) -> float:
    """RMS residual (pixels) of the best similarity transform of `prev` onto `cur` (Umeyama)."""
    mp, mc = prev.mean(0), cur.mean(0)
    p, c = prev - mp, cur - mc
    var = float((p ** 2).sum())
    if var < 1e-9:
        return 0.0
    u, s, vt = np.linalg.svd(c.T @ p)
    d = np.sign(np.linalg.det(u @ vt)) or 1.0
    dmat = np.diag([1.0, d])
    r = u @ dmat @ vt
    scale = float((s * np.diag(dmat)).sum() / var)
    fitted = scale * (p @ r.T) + mc
    return float(np.sqrt(((fitted - cur) ** 2).sum(1).mean()))


def track(frames: list[list[Hand]]) -> list[dict[int, Hand]]:
    """Two hand tracks by nearest wrist to each track's last position (handedness labels flip)."""
    last: dict[int, np.ndarray] = {}
    out: list[dict[int, Hand]] = []
    for hands in frames:
        cur: dict[int, Hand] = {}
        hs = sorted(hands[:2], key=lambda h: float(h.xy[0, 0]))
        if len(hs) == 2 and len(last) < 2:
            cur = {0: hs[0], 1: hs[1]}
        elif len(hs) == 2:
            a, b = hs
            keep = (_d(a, last[0]) + _d(b, last[1])) <= (_d(a, last[1]) + _d(b, last[0]))
            cur = {0: a, 1: b} if keep else {0: b, 1: a}
        elif len(hs) == 1:
            h = hs[0]
            free = [k for k in (0, 1) if k not in last]
            if last and (len(last) == 2 or not free):
                cur = {min(last, key=lambda k: _d(h, last[k])): h}
            elif last:
                k0 = next(iter(last))
                # a lone new hand far from the known one starts the other track
                cur = {k0 if _d(h, last[k0]) < (hand_size(h.xy) * 2) ** 2 else free[0]: h}
            else:
                cur = {0: h}
        for k, h in cur.items():
            last[k] = h.xy[0]
        out.append(cur)
    return out


def _d(h: Hand, p: np.ndarray) -> float:
    return float(((h.xy[0] - p) ** 2).sum())


def inside(xy: np.ndarray, size: tuple[int, int], edge: float = EDGE) -> bool:
    m = edge * size[0]
    return bool(xy[:, 0].min() > m and xy[:, 1].min() > m and xy[:, 0].max() < size[0] - m
                and xy[:, 1].max() < size[1] - m)


def boxes_meet(a: np.ndarray, b: np.ndarray) -> bool:
    return bool((a.min(0) < b.max(0)).all() and (b.min(0) < a.max(0)).all())


def overlapped(t: dict[int, Hand]) -> bool:
    """Both hands found and their landmark boxes intersect (clasped or interlaced fingers)."""
    return len(t) == 2 and boxes_meet(t[0].xy, t[1].xy)


def last_seen(tracks: list[dict[int, Hand]]) -> list[dict[int, Hand]]:
    """Per frame, each track's most recent hand up to and including that frame."""
    last: dict[int, Hand] = {}
    out = []
    for t in tracks:
        last = {**last, **t}
        out.append(dict(last))
    return out


def check(frames: list[list[Hand]], size: tuple[int, int]) -> list[FrameCheck]:
    tracks = track(frames)
    seen = last_seen(tracks)
    n = len(frames)
    out = [FrameCheck() for _ in range(n)]
    for side in (0, 1):
        lums = [t[side].lum for t in tracks if side in t and not np.isnan(t[side].lum)]
        lum_med = float(np.median(lums)) if lums else None
        for i in range(n):
            fc = out[i]
            h = tracks[i].get(side)
            other = seen[i].get(1 - side)
            if h is None:
                last = seen[i - 1].get(side) if i else None
                if last is None or not inside(last.xy, size):
                    continue
                if other is not None and boxes_meet(last.xy, other.xy):
                    continue  # hidden behind the other hand (clasped): occluded, not melted
                fc.hands += 1
                fc.flags.append(f"{side}:lost")
                continue
            if other is not None and boxes_meet(h.xy, other.xy):
                # clasped (both found and overlapping, or one found over the other's last box):
                # interlaced fingers make MediaPipe's score, geometry, landmark jitter and the
                # luminance under the landmarks noise, so the frame is not judged for this hand
                fc.clasped += 1
                continue
            fc.hands += 1
            if h.score < CONF_MIN:
                fc.flags.append(f"{side}:conf={h.score:.2f}")
            fc.flags += [f"{side}:{f}" for f in bone_flags(h.world) + shape_flags(h.world)]
            if lum_med and not np.isnan(h.lum) and h.lum < FADE * lum_med:
                fc.flags.append(f"{side}:faded={h.lum / lum_med:.2f}")
            if i and side in tracks[i - 1]:
                res = fit_residual(tracks[i - 1][side].xy, h.xy) / hand_size(h.xy)
                if res > JUMP_MAX:
                    fc.flags.append(f"{side}:jump={res:.2f}")
    return out


@dataclass
class TakeScore:
    frames: int
    hand_frames: int
    good_share: float | None      # good hand frames / hand frames
    worst_window: float | None    # lowest good share over any WINDOW consecutive frames that
                                  # hold at least WINDOW // 2 hand frames
    worst_at: int | None          # first frame of that window
    flagged: list[int]            # frame indices with a flag


def score(checks: list[FrameCheck], window: int = WINDOW) -> TakeScore:
    hand = np.array([c.hands > 0 for c in checks])
    good = np.array([c.hands > 0 and c.good for c in checks])
    flagged = [i for i, c in enumerate(checks) if c.hands > 0 and not c.good]
    if not hand.any():
        return TakeScore(len(checks), 0, None, None, None, [])
    worst, at = None, None
    for s in range(0, max(1, len(checks) - window + 1)):
        h = hand[s:s + window].sum()
        if h < min(window // 2, hand.sum()):   # a window of mostly clasped frames says little
            continue
        share = float(good[s:s + window].sum() / h)
        if worst is None or share < worst:
            worst, at = share, s
    return TakeScore(len(checks), int(hand.sum()), round(float(good.sum() / hand.sum()), 4),
                     None if worst is None else round(worst, 4), at, flagged)
