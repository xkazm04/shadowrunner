// The rite's clock (costume 3.2): what the glass, the layer slots, the tape and the marks show at a
// given moment of a forge job. Driven by the status the forge client last reported (never ahead of
// it) and how long that status has run; the replay plane knows each status's recorded hold, so its
// progress is exact; the live plane does not, so progress there eases toward the end. Pure, no DOM.
//
// Decisions the spec leaves open:
// - Parts are found during `segmenting` and cut during `cutting`, in z order (back to front), one
//   by one across the status; static layers (the background plate) are found when filling starts
//   and count as cut once the fill is under way (past `FILL_CUT`) or the job is done.
// - A status the client skipped (a slow poll) simply counts as passed.
import type { ForgeStatus } from "@sr/forge/wire";
import type { Layer } from "@sr/rig";
import type { ReplayStep } from "../replayJobs";

export type RunStep = Exclude<ForgeStatus, "failed">;

/** Every step of a run, in order. */
export const RUN_STEPS: readonly RunStep[] = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done"];

export type SlotState = "waiting" | "found" | "cut";

/** Live progress through a status of unknown length: 1 - e^(-ms / LIVE_EASE_MS). */
export const LIVE_EASE_MS = 8000;
/** Into `filling`, the background counts as cut. */
export const FILL_CUT = 0.3;

const rankOf = (status: RunStep): number => RUN_STEPS.indexOf(status);
const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The recorded hold of `status`, if the steps name it. */
export const holdOf = (steps: readonly ReplayStep[], status: RunStep): number | undefined => steps.find((s) => s.status === status)?.holdMs;

/** ms from the job's start to the start of `status` on a recording (sum of the earlier holds). */
export function startOf(steps: readonly ReplayStep[], status: RunStep): number {
  let at = 0;
  for (const step of steps) {
    if (rankOf(step.status as RunStep) >= rankOf(status)) break;
    at += step.holdMs;
  }
  return at;
}

/** 0..1 through `status`, `ms` after it began: exact on a recording, easing on live. Done is 1. */
export function progressIn(status: RunStep, ms: number, steps?: readonly ReplayStep[]): number {
  if (status === "done") return 1;
  const hold = steps === undefined ? undefined : holdOf(steps, status);
  if (hold !== undefined) return hold <= 0 ? 1 : unit(ms / hold);
  return unit(1 - Math.exp(-Math.max(0, ms) / LIVE_EASE_MS));
}

/** How many of `n` things a status has reached, `p` of the way through `during`. */
function reached(status: RunStep, p: number, during: RunStep, n: number): number {
  const r = rankOf(status);
  const d = rankOf(during);
  if (r < d) return 0;
  if (r > d) return n;
  return Math.min(n, Math.max(0, Math.ceil(unit(p) * n - 0.25)));
}

export interface Counts {
  /** Parts found (non-static layers). */
  found: number;
  /** Parts cut. */
  cut: number;
  /** The plate behind the cuts is filled. */
  filled: boolean;
  /** Moving parts in all. */
  parts: number;
}

export function countsAt(parts: number, status: RunStep, p: number): Counts {
  const r = rankOf(status);
  const filled = r > rankOf("filling") || (status === "filling" && unit(p) >= FILL_CUT);
  return { found: reached(status, p, "segmenting", parts), cut: reached(status, p, "cutting", parts), filled, parts };
}

/** Each layer's slot at that moment, by layer name. */
export function slotsAt(layers: readonly Layer[], status: RunStep, p: number): Record<string, SlotState> {
  const moving = layers.filter((l) => l.kind !== "static").sort((a, b) => a.z - b.z);
  const { found, cut, filled } = countsAt(moving.length, status, p);
  const out: Record<string, SlotState> = {};
  moving.forEach((l, i) => {
    out[l.name] = i < cut ? "cut" : i < found ? "found" : "waiting";
  });
  for (const l of layers) {
    if (l.kind === "static") out[l.name] = filled ? "cut" : rankOf(status) >= rankOf("filling") ? "found" : "waiting";
  }
  return out;
}

/** The four marks: Describe, Bind, Forge, Wake. */
export type Mark = 0 | 1 | 2 | 3;
export const MARKS: readonly { name: string; numeral: string; hint: string }[] = [
  { name: "Describe", numeral: "I", hint: "words or a drawing" },
  { name: "Bind", numeral: "II", hint: "voice · palette · archetype" },
  { name: "Forge", numeral: "III", hint: "the forge cuts the face" },
  { name: "Wake", numeral: "IV", hint: "hand the face to the glass" },
];

/** The mark the rite stands at: the forge's phase decides once a job exists, else the visitor's step. */
export function markOf(phase: "idle" | "running" | "done" | "failed", chosen: 0 | 1, failedAt?: "describe" | "forge"): Mark {
  if (phase === "running") return 2;
  if (phase === "done") return 3;
  if (phase === "failed") return failedAt === "describe" ? 0 : 2;
  return chosen;
}

/** "03.5 s": seconds with one decimal, two-digit whole part. */
export const clockText = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1).padStart(4, "0")} s`;

/** "2.16 s", "17.3 s": a duration with three significant digits. */
export function secText(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
}
