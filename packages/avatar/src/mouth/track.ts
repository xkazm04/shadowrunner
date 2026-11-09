// The viseme scheduler (pure, no DOM), moved here from the Avatar Lab's lip arms (perfection-pass
// task 4) so the product's lip-sync and the lab's L1/L2 share it: viseme spans arrive relative to
// their utterance's audio start; once that start is known on the audio clock, each span becomes an
// absolute window on it, and `weights(nowMs)` mixes the shapes with coarticulation. A viseme is any
// label the caller maps to one of the eight shapes (the lab maps the Oculus 15); without a map the
// labels are the shapes themselves.
//
// Coarticulation: every span's weight rises over BLEND_MS centred on its start and falls over
// BLEND_MS centred on its end (smoothstep edges). Neighbouring spans therefore crossfade over
// BLEND_MS (their edges sum to exactly 1), a span is dominant a third of BLEND_MS after its start,
// and after the last span the mouth is fully at rest BLEND_MS / 2 later. Nothing is ever a hard cut:
// the weights are continuous in time. Overlapping spans are normalised; rest takes what is left.
// `mixSpans` is the same mix over a fixed list (the analyser's MouthTrack, speech/analyse.ts); a span
// may carry a `weight` under 1 (a quiet syllable opens less), the remainder going to rest.
import { MOUTH_SHAPES, restWeights, type MouthShape, type ShapeWeights } from "./shapes.js";

/** Crossfade width between neighbouring shapes, ms (the lab brief asked for ~40-60). */
export const BLEND_MS = 50;
/** The jaw eases toward its target (the driver's attack); reading its mix this much early keeps it on time. */
export const JAW_LEAD_MS = 30;
/** Spans and utterances that ended this long ago are dropped. */
const KEEP_MS = 2000;

/** One shape held over a window, ms. */
export interface ShapeSpan {
  shape: MouthShape;
  startMs: number;
  endMs: number;
  /** 0..1, how far the span's shape replaces rest (omitted = 1). */
  weight?: number;
}

interface Line {
  atMs?: number;
  durationMs?: number;
  /** Relative to the line's audio start until `atMs` is known. */
  spans: ShapeSpan[];
}

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** One span's weight at `t` (absolute ms). */
export function spanWeight(span: { startMs: number; endMs: number }, t: number, blendMs = BLEND_MS): number {
  if (!(span.endMs > span.startMs)) return 0;
  const half = blendMs / 2;
  return smoothstep((t - (span.startMs - half)) / blendMs) * smoothstep((span.endMs + half - t) / blendMs);
}

/**
 * The mix of `spans` (each offset by `offsetMs`) at `nowMs`, summing to 1 (rest takes what is
 * left). Spans are visited from `from` (an index the caller knows is safe to skip to) and the walk
 * stops at the first span starting after `nowMs + blendMs` when `sorted` (by start).
 */
export function mixSpans(spans: readonly ShapeSpan[], nowMs: number, options: { blendMs?: number; offsetMs?: number; from?: number; sorted?: boolean } = {}): ShapeWeights {
  const blendMs = options.blendMs ?? BLEND_MS;
  const offset = options.offsetMs ?? 0;
  const out = restWeights();
  out.rest = 0;
  let total = 0;
  let shaped = 0;
  for (let i = Math.max(0, options.from ?? 0); i < spans.length; i += 1) {
    const s = spans[i];
    if (s === undefined) continue;
    if (options.sorted === true && s.startMs + offset > nowMs + blendMs) break;
    const w = spanWeight({ startMs: offset + s.startMs, endMs: offset + s.endMs }, nowMs, blendMs);
    if (!(w > 0)) continue;
    const k = Math.min(1, Math.max(0, s.weight ?? 1));
    out[s.shape] += w * k;
    shaped += w * k;
    total += w;
  }
  if (total > 1) for (const shape of MOUTH_SHAPES) out[shape] /= total;
  out.rest += Math.max(0, 1 - (total > 1 ? shaped / total : shaped));
  return out;
}

export interface VisemeTrack<V extends string = MouthShape> {
  /** A viseme span of utterance `id`, ms from that utterance's audio start. */
  addViseme(id: string, v: V, startMs: number, endMs: number): void;
  /** Utterance `id`'s first sample plays at `atMs` on the audio clock. */
  startUtterance(id: string, atMs: number, durationMs: number): void;
  /** Shape weights at `nowMs` (audio clock), summing to 1. */
  weights(nowMs: number): ShapeWeights;
  /** Whether an utterance is playing at `nowMs`, and whether it carries visemes. */
  speech(nowMs: number): "silent" | "visemes" | "unmarked";
}

const isShape = (v: string): v is MouthShape => (MOUTH_SHAPES as readonly string[]).includes(v);

/** A scheduler whose visemes are the eight shapes. */
export function createVisemeTrack(blendMs?: number): VisemeTrack;
/** A scheduler whose visemes map to shapes through `shapeOf` (e.g. the lab's Oculus 15). */
export function createVisemeTrack<V extends string>(shapeOf: Readonly<Record<V, MouthShape>>, blendMs?: number): VisemeTrack<V>;
export function createVisemeTrack(first?: number | Readonly<Record<string, MouthShape>>, second?: number): VisemeTrack<string> {
  const shapeOf = typeof first === "object" ? first : undefined;
  const blendMs = (typeof first === "number" ? first : second) ?? BLEND_MS;
  const lines = new Map<string, Line>();
  const line = (id: string): Line => {
    let l = lines.get(id);
    if (l === undefined) {
      l = { spans: [] };
      lines.set(id, l);
    }
    return l;
  };
  const prune = (nowMs: number): void => {
    for (const [id, l] of lines) {
      const at = l.atMs;
      if (at === undefined) continue;
      const lastEnd = Math.max(at + (l.durationMs ?? 0), ...l.spans.map((s) => at + s.endMs));
      if (lastEnd + KEEP_MS < nowMs) lines.delete(id);
    }
  };

  return {
    addViseme(id, v, startMs, endMs) {
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      const shape = shapeOf === undefined ? (isShape(v) ? v : undefined) : shapeOf[v];
      if (shape !== undefined) line(id).spans.push({ shape, startMs, endMs });
    },
    startUtterance(id, atMs, durationMs) {
      const l = line(id);
      l.atMs = atMs;
      l.durationMs = durationMs;
    },
    weights(nowMs) {
      prune(nowMs);
      const all: ShapeSpan[] = [];
      for (const l of lines.values()) {
        const at = l.atMs;
        if (at === undefined) continue;
        for (const s of l.spans) all.push({ shape: s.shape, startMs: at + s.startMs, endMs: at + s.endMs });
      }
      return mixSpans(all, nowMs, { blendMs });
    },
    speech(nowMs) {
      let state: "silent" | "visemes" | "unmarked" = "silent";
      for (const l of lines.values()) {
        if (l.atMs === undefined || l.durationMs === undefined) continue;
        if (nowMs < l.atMs || nowMs > l.atMs + l.durationMs) continue;
        if (l.spans.length > 0) return "visemes";
        state = "unmarked";
      }
      return state;
    },
  };
}
