// The lip arms draw on the voice's clock (perfection-pass requirement 14.3): seven real Kokoro clips
// (one per voice, kokoro-lag.fixture.json, written by scripts/lipfit/lag.ts) are fed to the shared
// driver as the lab feeds them (Kokoro's spans as given, the audio starting at AT_MS), and the
// drawn mouth (open where rest is under half) is scored against the clip's own 10 ms levels with
// the instrument lag.ts measures Kokoro with: the lag L maximising sum s(t_i + L) * (db_i + 30).
// It must be under one 60 Hz frame. Reading the spans as given scores about +57 ms (red).
import type { AvatarPlayer } from "@sr/avatar/core";
import { describe, expect, it } from "vitest";
import { VISEMES, type Viseme } from "../../../../contract.js";
import type { LipContext } from "../../../types.js";
import { createMouthDriver } from "../driver.js";
import raw from "./kokoro-lag.fixture.json";

interface FixtureClip { id: string; voice: string; spans: { v: Viseme; startMs: number; endMs: number }[]; db: number[] }
const isViseme = (v: string): v is Viseme => (VISEMES as readonly string[]).includes(v);
const fixture: { clips: FixtureClip[] } = {
  clips: raw.clips.map((c) => ({ ...c, spans: c.spans.flatMap((s) => (isViseme(s.v) ? [{ ...s, v: s.v }] : [])) })),
};

const FRAME_MS = 1000 / 60;
const AT_MS = 1000;
const SEARCH_MS = 100;

/** The mouth an arm draws for `clip`, as +1 (open) / -1 (rest) at any audio-clock time. */
function drawnMouth(clip: FixtureClip): (tMs: number) => number {
  let rest = 1;
  const player = {
    attachAudio: () => undefined,
    setLevel: () => undefined,
    setMouthShapes: (s: { rest: number } | undefined) => {
      rest = s?.rest ?? 1;
    },
    mouthMode: () => "drawn",
  } as Partial<AvatarPlayer> as AvatarPlayer;
  const ctx: LipContext = {
    character: "the-tallyman",
    mouth: { cx: 0, lineY: 0, width: 10 },
    player,
    audio: { context: {} as AudioContext, output: {} as GainNode, nowMs: () => 0, level: () => 0 },
    reducedMotion: false,
    addPainter: () => undefined,
  };
  const d = createMouthDriver("L1", ctx);
  for (const s of clip.spans) d.onViseme({ t: 0, kind: "viseme", id: clip.id, v: s.v, startMs: s.startMs, endMs: s.endMs });
  d.onAudio({ t: 0, kind: "audio", id: clip.id, sampleRate: 24000, pcmRef: `audio/${clip.id}.wav`, durationMs: clip.db.length * 10 }, AT_MS);
  return (tMs) => {
    d.frame(AT_MS + tMs);
    return rest < 0.5 ? 1 : -1;
  };
}

describe("lip arms on the voice's clock", () => {
  it("draws real Kokoro lines within one frame of their audio", () => {
    expect(fixture.clips.length).toBeGreaterThanOrEqual(7);
    expect(fixture.clips.flatMap((c) => c.spans)).toHaveLength(raw.clips.flatMap((c) => c.spans).length);
    const pooled = new Array<number>(2 * SEARCH_MS + 1).fill(0);
    for (const clip of fixture.clips) {
      const mouth = drawnMouth(clip);
      // The mouth at every ms the search can ask for, so each lag reuses one pass of frames.
      const first = -SEARCH_MS;
      const drawn = Array.from({ length: clip.db.length * 10 + 2 * SEARCH_MS + 1 }, (_, k) => mouth(first + k));
      for (let k = 0; k < pooled.length; k += 1) {
        let s = 0;
        clip.db.forEach((db, i) => (s += (drawn[i * 10 + k] ?? -1) * (db + 30)));
        pooled[k] = (pooled[k] ?? 0) + s;
      }
    }
    const lag = pooled.indexOf(Math.max(...pooled)) - SEARCH_MS;
    expect(Math.abs(lag)).toBeLessThan(FRAME_MS);
  });
});
