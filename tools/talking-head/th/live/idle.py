"""`th live make-idle`: render Iris's idle loop offline with FlashHead Lite.

FlashHead on silence is a still image with texture shimmer (v1 measurement), so the idle loop is
rendered from an "idle performance" track. Several candidate tracks are rendered through the same
streaming model as the live engine (with the seam blend), measured (measure.py: head range, blinks,
mouth gap, steps) and the best closed-mouth loop with a clean wrap is kept. Two loops are built per
track: the best contiguous closed-mouth span (`pick_loop`), and the closed stretches spliced
(`splice_frames`: every open-mouth frame cut out, 6-frame crossfades at the cuts). FlashHead moves
the head and blinks around voiced sounds and is nearly still otherwise, so the splice is what keeps
that life without an open mouth. Where it runs:
- core env (`make_idle`): builds the candidate tracks (numpy breaths and hums; Kokoro "mm" sounds and
  short phrases) and spawns the FlashHead env (generation: no GPU lock);
- FlashHead env (`render_idle`): renders, measures, picks, writes
  $TH_HOME/live/idle/iris/{loop.npz, loop.json, loop-sheet.png, loop-2x.mp4} and work/ (each
  candidate's clip with its audio, a sheet and candidates.json).
Either way the loop's end fades into its start over 6 frames, so the wrap steps like any other pair.
"""

from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path

import numpy as np

RATE = 16000
FPS = 25
WRAP_FADE = 6
MIN_LOOP_S = 6.0
WARMUP_CHUNKS = 2
SPLICE_MARGIN = 3  # frames trimmed off each closed stretch (no half-open mouth at a cut)
SPLICE_MIN = 25
KOKORO_MM = ["Mm.", "Mmm.", "Mm-hm.", "Hmm."]
KOKORO_PHRASES = ["Okay.", "Mm, right.", "I see.", "Mhm."]
KOKORO_LINES = ["Well, let me think about that for a moment.", "Hmm, yes, I see what you mean.",
                "That sounds about right to me."]
LOWPASS_HZ = 300


# ---- candidate tracks (core env) -------------------------------------------------------------------


def _env(n: int, attack: float, release: float) -> np.ndarray:
    a, r = max(1, int(attack * RATE)), max(1, int(release * RATE))
    e = np.ones(n, np.float32)
    e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    e[n - r:] = np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return e


def _at_db(x: np.ndarray, db: float) -> np.ndarray:
    rms = float(np.sqrt(np.mean(x ** 2))) or 1.0
    return (x / rms * 10 ** (db / 20)).astype(np.float32)


def breath(rng: np.random.Generator, inhale: bool, db: float = -30.0) -> np.ndarray:
    from scipy.signal import butter, sosfilt

    dur = 0.45 if inhale else 0.7
    n = int(dur * RATE)
    sos = butter(2, (500, 4000) if inhale else (250, 2500), "bandpass", fs=RATE, output="sos")
    x = sosfilt(sos, rng.standard_normal(n)).astype(np.float32)
    return _at_db(x * _env(n, dur * 0.4, dur * 0.5), db)


def hum(rng: np.random.Generator, dur: float = 0.5, db: float = -22.0) -> np.ndarray:
    """A closed-mouth nasal murmur: harmonics of a gently falling f0, low-passed."""
    from scipy.signal import butter, sosfilt

    n = int(dur * RATE)
    t = np.arange(n) / RATE
    f0 = rng.uniform(175, 210) * (1 - 0.08 * t / dur) * (1 + 0.01 * np.sin(2 * np.pi * 5 * t))
    ph = 2 * np.pi * np.cumsum(f0) / RATE
    x = sum(np.sin(k * ph) / k ** 1.2 for k in range(1, 13))
    x = sosfilt(butter(2, 900, "lowpass", fs=RATE, output="sos"), x)
    return _at_db(x * _env(n, 0.06, 0.15), db)


def _place(track: np.ndarray, x: np.ndarray, at_s: float) -> None:
    i = int(at_s * RATE)
    n = min(len(x), len(track) - i)
    if n > 0:
        track[i:i + n] += x[:n]


def candidate_tracks(seconds: float, kokoro=None, seed: int = 1116) -> dict[str, np.ndarray]:
    """name -> 16 kHz float32 track. `kokoro(text) -> 16 kHz samples` adds the Kokoro candidates."""
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE)
    out: dict[str, np.ndarray] = {"silence": np.zeros(n, np.float32)}

    def timeline(period: float, events) -> np.ndarray:
        tr = np.zeros(n, np.float32)
        t, k = 1.0, 0
        while t < seconds - 1.5:
            for off, x in events(k):
                _place(tr, x, t + off)
            t += period + rng.uniform(-0.4, 0.4)
            k += 1
        return np.clip(tr, -1, 1)

    out["breaths"] = timeline(3.4, lambda k: [(0, breath(rng, True)), (0.55, breath(rng, False))])
    out["hums"] = timeline(3.0, lambda k: [(0, breath(rng, True)), (0.6, hum(rng))]
                           if k % 2 == 0 else [(0, hum(rng, 0.4)), (0.7, breath(rng, False))])
    if kokoro is not None:
        mm = [kokoro(t) for t in KOKORO_MM]
        ph = [kokoro(t) for t in KOKORO_PHRASES]
        out["kokoro-mm"] = timeline(3.0, lambda k: [(0, breath(rng, True)), (0.6, mm[k % len(mm)])])
        out["kokoro-phrases"] = timeline(4.2, lambda k: [(0, ph[k % len(ph)])])
        # sparse: one "mm" every ~7 s, so the quiet stretch between two can hold a whole loop
        out["mm-sparse"] = timeline(7.0, lambda k: [(0, breath(rng, True)), (0.6, mm[k % len(mm)])])
        # speech low-passed to its voicing: the intonation without the articulation (a hummed line)
        from scipy.signal import butter, sosfilt

        lp = butter(4, LOWPASS_HZ, "lowpass", fs=RATE, output="sos")
        hummed = [_at_db(sosfilt(lp, kokoro(t)).astype(np.float32), -24.0) for t in KOKORO_LINES]
        out["hummed-speech"] = timeline(4.0, lambda k: [(0, hummed[k % len(hummed)])])
        out["hummed-sparse"] = timeline(6.5, lambda k: [(0, hummed[k % len(hummed)])])
    return out


def write_wav(path: Path, x: np.ndarray, rate: int = RATE) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768


def make_idle(seconds: float = 12.0, pick: str | None = None, only: list[str] | None = None) -> Path:
    """Core env: candidate tracks, then the FlashHead env renders and picks (no GPU lock)."""
    from ..gpu import memory_used_mib, others_over_limit
    from .compose import idle_dir
    from .env import ensure_requirements, spawn
    from .tts import InProcessKokoro, to_16k

    ensure_requirements()
    work = idle_dir() / "work"
    work.mkdir(parents=True, exist_ok=True)
    k = InProcessKokoro()
    tracks = candidate_tracks(max(2 * seconds, 20.0), lambda t: to_16k(*k.synth(t)))
    names = [n for n in tracks if not only or n in only]
    for name in names:
        write_wav(work / f"{name}.wav", tracks[name])
    args = ["make-idle", "--work", str(work), "--seconds", str(seconds), "--names", ",".join(names)]
    args += ["--pick", pick] if pick else []
    # generation, not a measurement: no GPU lock (Director ruling, 2026-11-16); co-tenants recorded
    co = {"start": others_over_limit(), "usedMiB": memory_used_mib()}
    code = spawn(args).wait()
    co["end"] = others_over_limit()
    if code != 0:
        raise SystemExit(f"th live make-idle: the FlashHead env failed ({code})")
    (work / "gpu.json").write_text(json.dumps(co) + "\n", encoding="utf-8", newline="\n")
    return idle_dir()


# ---- render and pick (FlashHead env) -----------------------------------------------------------------


def _render(model, audio: np.ndarray) -> np.ndarray:
    from .compose import Compositor
    from .models import SLICE_SAMPLES

    model.pipe.reset_person_name()  # each candidate starts from the reference pose
    model.window[:] = 0
    comp = Compositor(blend=True)
    out = []
    for k in range(len(audio) // SLICE_SAMPLES):
        new = model.chunk(audio[k * SLICE_SAMPLES:(k + 1) * SLICE_SAMPLES])
        _, fr = comp.seam(k, new, model.motion_frames)
        out.append(fr.cpu().numpy())
    return np.concatenate(out)


def _sheet(frames: np.ndarray, path: Path, n: int = 8, tw: int = 256) -> None:
    from PIL import Image

    picks = np.linspace(0, len(frames) - 1, n).astype(int)
    cols = 4
    sheet = Image.new("RGB", (tw * cols, tw * ((n + cols - 1) // cols)))
    for j, i in enumerate(picks):
        sheet.paste(Image.fromarray(frames[i]).resize((tw, tw)), ((j % cols) * tw, (j // cols) * tw))
    sheet.save(path)


def _clip(frames: np.ndarray, path: Path, audio: np.ndarray | None = None) -> None:
    from ..ffmpeg import FrameWriter, run_ffmpeg

    silent = path.with_suffix(".v.mp4") if audio is not None else path
    with FrameWriter(silent, frames.shape[2:0:-1], FPS, "rgb24",
                     ["-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p"]) as w:
        for f in frames:
            w.write(f)
    if audio is not None:
        wav = path.with_suffix(".wav")
        write_wav(wav, audio)
        run_ffmpeg(["-i", str(silent), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-shortest", str(path)])
        silent.unlink()
        wav.unlink()


def loop_frames(frames: np.ndarray, a: int, b: int) -> np.ndarray:
    """frames[a:b] with the last WRAP_FADE frames mixed toward frames[a-WRAP_FADE:a] (the frames
    that lead into the loop's first frame, reaching it at the last), so the wrap is an ordinary step
    and any pose mismatch is spread over WRAP_FADE steps."""
    loop = frames[a:b].copy()
    if a >= WRAP_FADE:
        w = (np.arange(WRAP_FADE, dtype=np.float32) + 1) / WRAP_FADE  # the last frame IS frames[a-1]
        tail = loop[-WRAP_FADE:].astype(np.float32)
        lead = frames[a - WRAP_FADE:a].astype(np.float32)
        loop[-WRAP_FADE:] = np.rint(tail * (1 - w[:, None, None, None]) + lead * w[:, None, None, None])
    return loop


def _xfade(a: np.ndarray, b: np.ndarray, full: bool = False) -> np.ndarray:
    """a then b, the last WRAP_FADE frames of a mixed into the first WRAP_FADE of b (`full`: the
    last mixed frame is b's own, so what follows it is b's natural next frame)."""
    w = ((np.arange(WRAP_FADE, dtype=np.float32) + 1) / (WRAP_FADE + (0 if full else 1)))[:, None, None, None]
    mid = np.rint(a[-WRAP_FADE:].astype(np.float32) * (1 - w) + b[:WRAP_FADE].astype(np.float32) * w)
    return np.concatenate([a[:-WRAP_FADE], mid.astype(np.uint8), b[WRAP_FADE:]])


def splice_frames(frames: np.ndarray, gap: np.ndarray, skip: int, max_len: int, min_len: int,
                  thumbs: np.ndarray | None = None) -> tuple[np.ndarray, list[int]] | None:
    """The closed-mouth stretches of a render, in order, each trimmed by SPLICE_MARGIN frames and at
    least SPLICE_MIN long, joined with WRAP_FADE-frame crossfades (also last stretch to first) until
    max_len. This keeps the head motion and blinks that happen around the sounds and cuts out every
    frame with the mouth open. With `thumbs`, the cycle is rotated so that its frame 0 follows its
    last frame by the smallest plain source step: the wrap is never a cut; the cuts are reported as
    junctions. Returns the loop and the frame index of each junction, or None when the
    stretches add up to less than min_len or there is only one (pick_loop covers that)."""
    from .measure import MOUTH_CLOSED_PX

    closed = np.nan_to_num(gap, nan=99) <= MOUTH_CLOSED_PX
    closed[:skip] = False
    runs, i, n = [], 0, len(closed)
    while i < n:
        if closed[i]:
            j = i
            while j < n and closed[j]:
                j += 1
            lo, hi = i + SPLICE_MARGIN, j - SPLICE_MARGIN
            if hi - lo >= SPLICE_MIN:
                runs.append((lo, hi))
            i = j
        else:
            i += 1
    take, total = [], WRAP_FADE  # the wrap crossfade eats WRAP_FADE frames of the first stretch
    for lo, hi in runs:
        if total >= max_len:
            break
        hi = min(hi, lo + max_len - total + WRAP_FADE)
        take.append((lo, hi))
        total += hi - lo - WRAP_FADE
    if len(take) < 2 or total < min_len:
        return None
    first = frames[take[0][0]:take[0][1]]
    out, junctions, src = first[WRAP_FADE:], [], list(range(take[0][0] + WRAP_FADE, take[0][1]))
    for lo, hi in take[1:]:
        junctions.append(len(out) - WRAP_FADE)
        out = _xfade(out, frames[lo:hi])
        src = src[:-WRAP_FADE] + [-1] * WRAP_FADE + list(range(lo + WRAP_FADE, hi))
    out = _xfade(out, np.concatenate([first[:WRAP_FADE], first[WRAP_FADE:WRAP_FADE + 1]]))[:-1]
    junctions.append(len(out) - WRAP_FADE)
    src = src[:-WRAP_FADE] + [-1] * WRAP_FADE
    if thumbs is not None:
        # the cycle is the same from any frame: start it where the step into a frame is an unmixed
        # source step (src[r-1] + 1 == src[r]) and the smallest, so frame 0 is not at a cut
        ok = [r for r in range(1, len(src)) if src[r - 1] >= 0 and src[r] == src[r - 1] + 1]
        if ok:
            r = min(ok, key=lambda r: float(np.abs(thumbs[src[r]] - thumbs[src[r - 1]]).mean()))
            out = np.roll(out, -r, axis=0)
            junctions = sorted((j - r) % len(out) for j in junctions)
    return out, junctions


def _figures(loop: np.ndarray, junctions: list[int]) -> dict:
    from .measure import steps, summary, track

    tr = track(loop)
    f = summary(tr)
    st = steps(tr.thumbs)
    med = float(np.median(st))
    wrap = float(np.abs(tr.thumbs[-1] - tr.thumbs[0]).mean())
    jmax = [float(st[max(0, j - 1):j + WRAP_FADE + 1].max()) for j in junctions]
    f.update({"wrapStep": round(wrap, 3), "wrapOverMedian": round(wrap / med, 3),
              "junctions": len(junctions), "junctionMaxStepOverMedian":
              None if not jmax else round(max(jmax) / med, 3)})
    return f


def render_idle(work: Path, seconds: float, names: list[str], pick: str | None = None) -> int:
    """Render each candidate, build two loops from it (the best contiguous closed-mouth span, and
    the closed stretches spliced), measure each loop as it will play, keep the best."""
    from .compose import idle_dir
    from .measure import pick_loop, summary, track
    from .models import FlashHeadModel, bust_crop

    out_dir = idle_dir()
    model = FlashHeadModel(bust_crop())
    model.load()
    skip = WARMUP_CHUNKS * 24
    lo_len, hi_len = int(MIN_LOOP_S * FPS), int(seconds * FPS)
    results, best = {}, None
    for name in names:
        audio = read_wav(work / f"{name}.wav")
        t0 = time.perf_counter()
        frames = _render(model, audio)
        render_s = time.perf_counter() - t0
        tr = track(frames)
        r: dict = {"renderS": round(render_s, 1), "all": summary(tr, skip)}
        loops: dict[str, tuple[np.ndarray, list[int]]] = {}
        span = pick_loop(tr, lo_len, hi_len, skip=skip)
        if span:
            loops["span"] = (loop_frames(frames, span["start"], span["end"]), [])
            r["span"] = span
        sp = splice_frames(frames, tr.gap, skip, hi_len, lo_len, tr.thumbs)
        if sp:
            loops["splice"] = sp
        for method, (loop, junctions) in loops.items():
            fig = _figures(loop, junctions)
            r[method + "Loop"] = fig
            ok = fig["mouthClosedFrac"] == 1.0 and fig["wrapOverMedian"] <= 1.0
            rank = (name == pick, ok, min(fig["blinks"], 3),
                    fig["headRangePx"]["x"] + fig["headRangePx"]["y"])
            if best is None or rank > best[0]:
                best = (rank, name, method, loop, fig)
        results[name] = r
        print(f"th make-idle: {name}: {json.dumps(r)}", file=sys.stderr, flush=True)
        _clip(frames, work / f"{name}.mp4", audio[:len(frames) * RATE // FPS])
        _sheet(frames[skip:], work / f"{name}-sheet.png")
        del frames, loops
    (work / "candidates.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8",
                                          newline="\n")
    if best is None:
        print("th make-idle: no candidate gave a closed-mouth loop", file=sys.stderr)
        return 2
    _, name, method, loop, fig = best
    meta = {"fps": FPS, "frames": int(len(loop)), "sourceAudio": f"{name}.wav", "method": method,
            "seamDiff": fig["wrapStep"], "medianStep": fig["stepMedian"], "figures": fig,
            "size": int(loop.shape[1])}
    np.savez(out_dir / "loop.npz", frames=loop)
    (out_dir / "loop.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="\n")
    _sheet(loop, out_dir / "loop-sheet.png", n=12)
    _clip(np.concatenate([loop, loop]), out_dir / "loop-2x.mp4")
    print(f"th make-idle: chose {name} ({method}): {json.dumps(meta)}", file=sys.stderr, flush=True)
    return 0
