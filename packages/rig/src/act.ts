// Signature acts (tiger L1, docs/rig-format.md "Act"): a part's own approved motion played ONCE,
// fired by a cue word in a spoken line. `Layer.act` names the cue words and the act's size and
// length; `Drive.act` says which layer's act started when. Pure, no I/O.
//
// Playback, `u = (t - startedAt) / s` in [0, 1), envelope `e = sin(pi*u)^2` (eases in and out):
// - float: one full period of the layer's own float in `s` seconds, times `gain * e`, added to the
//   idle float: its sway and side swing once, bigger, and its bob as a press down and back
//   (`(1 - cos)`, at least half the dip deep), so a glove slams and a stamp thunks;
// - pulse: the light gain is multiplied by `1 + gain * amp * e` (a surge of its own light);
// - neither: a dip-and-return, `dy = gain * ACT_DIP * height * e` canvas px down (a thunk).
// Outside [0, 1) the act gives exactly the idle motion, so `s` seconds after an act the pose is the
// idle pose bit for bit. Under reduced motion (`still`) there is no movement: the layer's light is
// raised by ACT_STILL_GAIN for the first half of the act, a single static beat, then put back.
import { motionAt, type MotionOffset } from "./motion.js";
import type { Layer, LayerAct, LayerKind } from "./types.js";

/** Cue words per act, and the longest cue word. */
export const ACT_CUE_MAX = 3;
export const ACT_CUE_CHARS = 24;
/** `gain` range and default. */
export const ACT_GAIN_MIN = 1;
export const ACT_GAIN_MAX = 3;
export const ACT_GAIN = 1.5;
/** `s` range and default, seconds. */
export const ACT_S_MIN = 0.6;
export const ACT_S_MAX = 1.5;
export const ACT_S = 1;
/** The dip of a part with no periodic motion at gain 1, as a fraction of the rig's height. */
export const ACT_DIP = 0.02;
/** The reduced-motion twin: the layer's light during the first half of the act. */
export const ACT_STILL_GAIN = 1.3;
/** Kinds that may carry an act (a lifted part: float, pulse, accessory, crown, hat). */
export const ACT_KINDS: readonly LayerKind[] = ["accessory", "crown"];

const CUE_WORD = /^[a-z][a-z0-9'-]*$/;

/** Which layer's act started, at the drive's `t` seconds. */
export interface ActCue {
  layer: string;
  startedAt: number;
}

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const inRange = (value: unknown, lo: number, hi: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi;

/**
 * `Layer.act` read leniently (readers drop bad entries, never fail the rig): cue words that are not
 * lowercase words of 1..ACT_CUE_CHARS characters are dropped, duplicates too, at most ACT_CUE_MAX
 * kept; a `gain` or `s` out of range is dropped (the default applies). No cue word left, or not an
 * object: no act.
 */
export function readAct(value: unknown): LayerAct | undefined {
  if (!isRecord(value) || !Array.isArray(value.cue)) return undefined;
  const cue: string[] = [];
  for (const word of value.cue as unknown[]) {
    if (typeof word !== "string" || word.length > ACT_CUE_CHARS || !CUE_WORD.test(word) || cue.includes(word)) continue;
    if (cue.length < ACT_CUE_MAX) cue.push(word);
  }
  if (cue.length === 0) return undefined;
  return {
    cue,
    ...(inRange(value.gain, ACT_GAIN_MIN, ACT_GAIN_MAX) ? { gain: value.gain } : {}),
    ...(inRange(value.s, ACT_S_MIN, ACT_S_MAX) ? { s: value.s } : {}),
  };
}

/** The act's length in seconds (`s`, else ACT_S). */
export const actSeconds = (act: LayerAct | undefined): number => act?.s ?? ACT_S;

/** Where the act is, 0..1, at `t`; undefined outside [0, 1) or when nothing is playing on `layer`. */
function progressOf(layer: Layer, cue: ActCue | undefined, t: number): number | undefined {
  if (cue === undefined || cue.layer !== layer.name || !Number.isFinite(t) || !Number.isFinite(cue.startedAt)) return undefined;
  const u = (t - cue.startedAt) / actSeconds(layer.act);
  return u >= 0 && u < 1 ? u : undefined;
}

/**
 * The layer's motion offset at `t` with an act in play: exactly `motionAt(layer.motion, t, still)`
 * when no act of this layer is playing (another layer's, none, before its start or after its end).
 * `height` is the rig's, for the dip.
 */
export function actMotionAt(layer: Layer, t: number, still: boolean, cue: ActCue | undefined, height: number): MotionOffset {
  const idle = motionAt(layer.motion, t, still);
  const u = progressOf(layer, cue, t);
  if (u === undefined) return idle;
  if (still) return u < 0.5 ? { ...idle, gain: idle.gain * ACT_STILL_GAIN } : idle;
  const gain = layer.act?.gain ?? ACT_GAIN;
  const e = Math.sin(Math.PI * u) ** 2;
  const { float, pulse } = layer.motion ?? {};
  if (float === undefined && pulse === undefined) return { ...idle, dy: idle.dy + gain * ACT_DIP * height * e };
  const out = { ...idle };
  if (float !== undefined) {
    const w = 2 * Math.PI * u;
    const k = gain * e;
    out.dx += k * float.amp[0] * Math.sin(w);
    out.dy += k * Math.max(float.amp[1], (ACT_DIP * height) / 2) * (1 - Math.cos(w));
    out.rotation += k * (((float.rot_deg ?? 0) * Math.PI) / 180) * Math.sin(w + Math.PI);
  }
  if (pulse !== undefined) out.gain *= 1 + gain * pulse.amp * e;
  return out;
}
