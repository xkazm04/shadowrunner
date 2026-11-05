// The viseme scheduler shared by L1 and L2 (pure, no DOM): viseme spans arrive relative to their
// utterance's audio start; once that start is known on the audio clock, each span becomes an
// absolute window on it, and `weights(nowMs)` mixes the shapes with coarticulation.
//
// Coarticulation: every span's weight rises over BLEND_MS centred on its start and falls over
// BLEND_MS centred on its end (smoothstep edges). Neighbouring spans therefore crossfade over
// BLEND_MS (their edges sum to exactly 1), a span is dominant a third of BLEND_MS after its start,
// and after the last span the mouth is fully at rest BLEND_MS / 2 later. Nothing is ever a hard cut:
// the weights are continuous in time. Overlapping spans are normalised; rest takes what is left.
import type { Viseme } from "../../../contract.js";
import { MOUTH_SHAPES, restWeights, VISEME_SHAPE, type MouthShape, type ShapeWeights } from "./shapes.js";

/** Crossfade width between neighbouring shapes, ms (the brief asks for ~40-60). */
export const BLEND_MS = 50;
/** Spans and utterances that ended this long ago are dropped. */
const KEEP_MS = 2000;

interface Span {
  shape: MouthShape;
  startMs: number;
  endMs: number;
}

interface Line {
  atMs?: number;
  durationMs?: number;
  /** Relative to the line's audio start until `atMs` is known. */
  spans: Span[];
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

export interface VisemeTrack {
  /** A viseme span of utterance `id`, ms from that utterance's audio start. */
  addViseme(id: string, v: Viseme, startMs: number, endMs: number): void;
  /** Utterance `id`'s first sample plays at `atMs` on the audio clock. */
  startUtterance(id: string, atMs: number, durationMs: number): void;
  /** Shape weights at `nowMs` (audio clock), summing to 1. */
  weights(nowMs: number): ShapeWeights;
  /** Whether an utterance is playing at `nowMs`, and whether it carries visemes. */
  speech(nowMs: number): "silent" | "visemes" | "unmarked";
}

export function createVisemeTrack(blendMs = BLEND_MS): VisemeTrack {
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
      line(id).spans.push({ shape: VISEME_SHAPE[v], startMs, endMs });
    },
    startUtterance(id, atMs, durationMs) {
      const l = line(id);
      l.atMs = atMs;
      l.durationMs = durationMs;
    },
    weights(nowMs) {
      prune(nowMs);
      const out = restWeights();
      out.rest = 0;
      let total = 0;
      for (const l of lines.values()) {
        if (l.atMs === undefined) continue;
        for (const s of l.spans) {
          const w = spanWeight({ startMs: l.atMs + s.startMs, endMs: l.atMs + s.endMs }, nowMs, blendMs);
          if (!(w > 0)) continue;
          out[s.shape] += w;
          total += w;
        }
      }
      if (total > 1) for (const shape of MOUTH_SHAPES) out[shape] /= total;
      out.rest += Math.max(0, 1 - total);
      return out;
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
