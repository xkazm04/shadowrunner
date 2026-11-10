// How a mouth track is scored against the reference: per 10 ms frame, the drawn mouth's parameters
// (blendParams of the shape mix) against the reference's, as a correlation r and a mean absolute
// error e per parameter. The reference is Kokoro's timed visemes crossfaded the way the lab draws
// them (mixSpans); the baseline is the loudness drive the product used before the analyser.
import { speechLevel } from "../../packages/avatar/src/audio/level.ts";
import { blendParams, levelWeights, type MouthParams, type ShapeWeights } from "../../packages/avatar/src/mouth/shapes.ts";
import { mixSpans, type ShapeSpan } from "../../packages/avatar/src/mouth/track.ts";
import { REF_SHIFT_MS, VISEME_SHAPE, type Clip } from "./corpus.ts";

export const PARAMS = ["jaw", "open", "round", "press", "width", "teeth", "tongue"] as const satisfies readonly (keyof MouthParams)[];
export type Track = (frame: number) => ShapeWeights;

/** The reference: the clip's visemes as shape spans, shifted like the labels. */
export function refTrack(c: Clip): Track {
  const spans: ShapeSpan[] = [];
  for (const s of c.spans) {
    const shape = VISEME_SHAPE[s.v];
    if (shape !== undefined && shape !== "rest") spans.push({ shape, startMs: s.startMs + REF_SHIFT_MS, endMs: s.endMs + REF_SHIFT_MS });
  }
  return (i) => mixSpans(spans, i * 10);
}

/** The loudness drive: each 25 ms window's RMS every 10 ms through the stage's speech level. */
export function loudnessTrack(samples: Float32Array, rate: number): Track {
  const hop = Math.round(rate / 100);
  const win = Math.round(rate * 0.025);
  const levels: number[] = [];
  for (let f = 0; f < Math.ceil(samples.length / hop); f++) {
    let q = 0;
    for (let i = 0; i < win; i++) {
      const x = samples[f * hop - (win >> 1) + i] ?? 0;
      q += x * x;
    }
    levels.push(speechLevel(Math.sqrt(q / win)));
  }
  return (i) => levelWeights(levels[i] ?? 0);
}

const corr = (a: readonly number[], b: readonly number[]): number => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb || 1);
};
const mae = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + Math.abs(x - (b[i] ?? 0)), 0) / a.length;

export class Score {
  private readonly ref = new Map<string, number[]>(PARAMS.map((k) => [k, []]));
  private readonly pred = new Map<string, number[]>(PARAMS.map((k) => [k, []]));
  /** Sum over frames of the jaw's frame-to-frame change (flicker). */
  private jawTravel = 0;
  private frames = 0;

  add(ref: Track, pred: Track, count: number): void {
    let prevJaw: number | undefined;
    for (let i = 0; i < count; i++) {
      const rp = blendParams(ref(i));
      const pp = blendParams(pred(i));
      for (const k of PARAMS) {
        this.ref.get(k)?.push(rp[k]);
        this.pred.get(k)?.push(pp[k]);
      }
      if (prevJaw !== undefined) this.jawTravel += Math.abs(pp.jaw - prevJaw);
      prevJaw = pp.jaw;
    }
    this.frames += count;
  }

  line(name: string): string {
    const cells = PARAMS.map((k) => `${k}:r=${corr(this.ref.get(k) ?? [], this.pred.get(k) ?? []).toFixed(2)}/e=${mae(this.ref.get(k) ?? [], this.pred.get(k) ?? []).toFixed(2)}`);
    return `${name.padEnd(22)}${cells.join(" ")} |d jaw|/10ms=${(this.jawTravel / Math.max(1, this.frames)).toFixed(4)}`;
  }
}
