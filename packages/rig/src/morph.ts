// The morph plan (companion-lanes design "Tracks"): from the frame's blink, gaze, mouth-shape
// weights and expression faces, one weight per morph key and the ordered list of the keys the
// renderer composites this frame. Pure, no DOM.
//
// Decisions the spec leaves open (documented here so the renderer, the builder and the docs agree):
// - Track values: blink is the caller's closure (the driver's, or a layer's own if larger), clamped
//   to [0, 1]; a mouth track is its shape's weight, the seven divided by their sum when it is above 1
//   (`rest` and any other key of the mix are ignored); before that sum (round 6) each mouth track but
//   `closed` and `teeth` is its shape times the morph's `mouthGain` for it (1 when absent) times the
//   face profile's `mouth.size` (1 when absent or not a finite positive), clamped to [0, 1]; a face track is its family's weight in the
//   mood crossfade (the outgoing family at 1 - smoothstep(mix), the incoming at smoothstep(mix), one
//   family listed once as in mood.ts `facesOf`) times `expression.strength`, 0 when retired; a gaze
//   track is `max(0, -gx)` / `max(0, gx)` with `gx = gaze.x * range / MORPH_GAZE_FULL` clamped to
//   [-1, 1] (L and R are the picture's left and right), and the same for y (U, D).
// - Stops: a track's keys sorted by `at` (missing = 1) are a1 < ... < an; with a0 = 0 (the layer's
//   own pixels), a value v in [a(k), a(k+1)] gives key k+1 the weight (v - a(k)) / (a(k+1) - a(k))
//   and key k (k >= 1) the rest; at or above an, the last key has weight 1. validateRig refuses two
//   keys at one stop of a track, so no interval is empty. Keys with a `part` (round 3) are stops of
//   their own half: a family's upper and lower keys each follow the track on their own.
// - Colour and motion (round 3, every key is painted on the neutral face): the plan gives each key
//   a motion weight (`weights`: what moves its pixels, and what makes it active) and a colour scale
//   (`colour`, 0..1: how much of its paint shows). A family key with part "lower" shows
//   `1 - speak` of its colour and moves at `w (1 - 0.5 speak)` while the mouth speaks (the mouth
//   keys then paint the mouth, the smile's motion still lifts it half way); a gaze key shows
//   `1 - E` with E = min(1, sum of the six family values) and moves at `w (1 - E)` (under an
//   expression its neutral eyes would ghost inside the expression's lids and its field, measured
//   on the neutral eye, smears them: the expression's own eyes hold); a blink key below the half stop
//   (`at` < BLINK_YIELD_BELOW, round 4) yields the same way, so a blink over a held expression starts
//   from the expression's own eyes and meets the half-closed lid at 0.5; every other key shows 1. A key whose colour is 0 but whose motion weight is
//   above the threshold stays active: it still moves pixels.
// - Active keys: weight > MORPH_MIN_WEIGHT; above MORPH_MAX_ACTIVE, the lowest weights are dropped
//   (a tie drops the key that composites later) and their weights read 0; the rest are ordered by
//   group (face < gaze < mouth < blink), then by the key's position in `morph.keys`.
// - No allocation per frame in steady state (perfection-pass P1): the static index and the plan are
//   built once per `RigMorph` object (rigs are not mutated) and refilled in place each call, so a
//   plan is valid until the next `morphPlan` call on the same morph.
import { EMOTION_FAMILY, EXPRESSION_FAMILIES } from "./control.js";

/** Blink stops below this `at` yield to a held expression (round 4: a neutral quarter-lid opened a furious glare). */
export const BLINK_YIELD_BELOW = 0.5;
import type { ResolvedFace } from "./face.js";
import { smoothstep } from "./look.js";
import type { Emotion, ExpressionFamily, MorphGainTrack, MorphTrack, Rig, RigMorph } from "./types.js";

/** The seven non-rest mouth shapes, as tracks (`@sr/avatar` MOUTH_SHAPES without `rest`). */
export const MORPH_MOUTH_TRACKS = ["openWide", "openMid", "round", "closed", "teeth", "tongue", "narrow"] as const satisfies readonly MorphTrack[];
/** The mouth tracks `mouthGain` and `mouth.size` scale (round 6): all but closed and teeth (the lips meet on p, b, m). */
export const MORPH_GAIN_TRACKS = ["openWide", "openMid", "round", "tongue", "narrow"] as const satisfies readonly MorphGainTrack[];
export const MORPH_GAZE_TRACKS = ["gazeL", "gazeR", "gazeU", "gazeD"] as const satisfies readonly MorphTrack[];
/** Every track, in group order: the six families, the gaze, the mouth, the blink. */
export const MORPH_TRACKS: readonly MorphTrack[] = Object.freeze([...EXPRESSION_FAMILIES, ...MORPH_GAZE_TRACKS, ...MORPH_MOUTH_TRACKS, "blink"]);
/** The compositing groups, back to front: a later group covers an earlier one. */
export const MORPH_GROUPS = ["face", "gaze", "mouth", "blink"] as const;
export type MorphGroup = (typeof MORPH_GROUPS)[number];

/** At most this many keys are composited per frame (the shader's uniform arrays). */
export const MORPH_MAX_ACTIVE = 8;
/** A key at or below this weight is not active. */
export const MORPH_MIN_WEIGHT = 0.002;
/** Wire limits (validateRig): keys per rig and stops per track. */
export const MORPH_MAX_KEYS = 40;
export const MORPH_MAX_STOPS = 4;
/** The gaze range at which a full gaze (|gaze| = 1) reaches a gaze track's value 1 (the default `gaze.range`). */
export const MORPH_GAZE_FULL = 0.6;

const TRACK_INDEX: ReadonlyMap<string, number> = new Map(MORPH_TRACKS.map((track, i) => [track, i]));
const MOUTH_SET: ReadonlySet<string> = new Set(MORPH_MOUTH_TRACKS);
const GAZE_SET: ReadonlySet<string> = new Set(MORPH_GAZE_TRACKS);
const GAIN_SET: ReadonlySet<string> = new Set(MORPH_GAIN_TRACKS);

/** Whether `value` names a track. */
export const isMorphTrack = (value: unknown): value is MorphTrack => typeof value === "string" && TRACK_INDEX.has(value);

/** The compositing group of a track. */
export function morphGroup(track: MorphTrack): MorphGroup {
  if (track === "blink") return "blink";
  if (MOUTH_SET.has(track)) return "mouth";
  return GAZE_SET.has(track) ? "gaze" : "face";
}

/** The group's index in MORPH_GROUPS (0 face .. 3 blink), the shader's group number. */
export const morphGroupIndex = (track: MorphTrack): number => MORPH_GROUPS.indexOf(morphGroup(track));

/** What a morph's keys are, by index, built once per morph. */
interface MorphIndex {
  /** Per key, its group index. */
  group: Uint8Array;
  /** Per track (MORPH_TRACKS index `track`) and part, its keys sorted by `at`, and their stops. */
  stops: { track: number; keys: Int32Array; at: Float64Array }[];
  /** Per key: 1 a family key with part "lower", 2 a gaze key, 0 any other. */
  kind: Uint8Array;
  /** Every key sorted by (group, position): the compositing order. */
  order: Int32Array;
  /** Whether some key sits in each group. */
  groups: boolean[];
  /** Per MORPH_MOUTH_TRACKS entry, its `mouthGain` (1 when absent, and always 1 on closed and teeth). */
  gain: Float64Array;
}

const indexes = new WeakMap<RigMorph, MorphIndex>();

function indexOf(morph: RigMorph): MorphIndex {
  let index = indexes.get(morph);
  if (index !== undefined) return index;
  const keys = morph.keys;
  const group = Uint8Array.from(keys, (key) => morphGroupIndex(key.track));
  const stops = MORPH_TRACKS.flatMap((track, t) =>
    (["upper", "lower", undefined] as const).flatMap((part) => {
      const on = keys.flatMap((key, i) => (key.track === track && key.part === part ? [i] : [])).sort((a, b) => (keys[a]?.at ?? 1) - (keys[b]?.at ?? 1) || a - b);
      return on.length === 0 ? [] : [{ track: t, keys: Int32Array.from(on), at: Float64Array.from(on, (i) => keys[i]?.at ?? 1) }];
    }),
  );
  const kind = Uint8Array.from(keys, (key) =>
    key.part === "lower" ? 1 : GAZE_SET.has(key.track) ? 2 : key.track === "blink" && (key.at ?? 1) < BLINK_YIELD_BELOW ? 3 : 0,
  );
  const order = Int32Array.from(keys.map((_, i) => i).sort((a, b) => (group[a] ?? 0) - (group[b] ?? 0) || a - b));
  const groups = MORPH_GROUPS.map(() => false);
  for (const g of group) groups[g] = true;
  const gain = Float64Array.from(MORPH_MOUTH_TRACKS, (track) => {
    const g = GAIN_SET.has(track) ? morph.mouthGain?.[track as MorphGainTrack] : undefined;
    return g !== undefined && Number.isFinite(g) && g > 0 ? Math.min(1, g) : 1;
  });
  index = { group, stops, kind, order, groups, gain };
  indexes.set(morph, index);
  return index;
}

/** Whether the morph has a key in `group` (a mouth key makes `mouthMode` "morph", a gaze key runs the eyes). */
export const morphHas = (morph: RigMorph | undefined, group: MorphGroup): boolean => morph !== undefined && indexOf(morph).groups[MORPH_GROUPS.indexOf(group)] === true;

/** Whether the rig's gaze is shown by morph keys (the driver then leads with the eyes, as on a rig with irises). */
export const hasMorphGaze = (rig: Pick<Rig, "morph">): boolean => morphHas(rig.morph, "gaze");

/** This frame's track inputs. */
export interface MorphInputs {
  /** 0..1 closure (`Drive.blink`, or a layer's own blink when larger). */
  blink: number;
  /** `Drive.gaze`; absent = rest. */
  gaze?: { x: number; y: number } | undefined;
  /** Mouth shape weights (any of MORPH_MOUTH_TRACKS; `rest` and other keys are ignored); absent = rest. */
  shapes?: Readonly<Partial<Record<string, number>>> | undefined;
  emotion: Emotion;
  /** `Drive.mood`: the crossfade in progress; absent = settled. */
  mood?: { from: Emotion; mix: number } | undefined;
  /** The face profile in force: `gaze.range`, `expression.strength`, the retired families and `mouth.size` (round 6; absent = 1). */
  face: Pick<ResolvedFace, "gaze" | "expression"> & { mouth?: { size?: number } };
  /** How much the mouth is speaking, 0..1 (round 3: a lower face key gives way); absent = 0. */
  speak?: number | undefined;
}

/** One frame's plan; reused per morph (valid until the next `morphPlan` call on that morph). */
export interface MorphPlan {
  morph: RigMorph;
  /** Per key (`morph.keys` order), its motion weight this frame; 0 when not active. */
  weights: Float64Array;
  /** Per key, its colour scale this frame, 0..1 (round 3; 1 unless a rule lowers it). */
  colour: Float64Array;
  /** The active keys' indices in compositing order; the first `count` are valid. */
  active: Int32Array;
  count: number;
  /** Per track (MORPH_TRACKS order), its value this frame (read only). */
  values: Float64Array;
}

const plans = new WeakMap<RigMorph, MorphPlan>();
/** Per key, 1 while still a candidate during `selectMorphKeys` (grown on need, never shrunk). */
let scratch = new Uint8Array(MORPH_MAX_KEYS);

const unit01 = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const signed = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);

/** The (reused) plan of a morph, weights cleared. */
function planOf(morph: RigMorph): MorphPlan {
  let plan = plans.get(morph);
  if (plan === undefined) {
    plan = { morph, weights: new Float64Array(morph.keys.length), colour: new Float64Array(morph.keys.length), active: new Int32Array(MORPH_MAX_ACTIVE), count: 0, values: new Float64Array(MORPH_TRACKS.length) };
    plans.set(morph, plan);
  }
  plan.weights.fill(0);
  plan.colour.fill(1);
  plan.values.fill(0);
  plan.count = 0;
  return plan;
}

/** The track values of this frame into `values` (MORPH_TRACKS order). */
function trackValues(inputs: MorphInputs, gain: Float64Array, values: Float64Array): void {
  values[TRACK_INDEX.get("blink") ?? 0] = unit01(inputs.blink);
  const s = inputs.face.mouth?.size;
  const size = s !== undefined && Number.isFinite(s) && s > 0 ? s : 1;
  let sum = 0;
  for (let m = 0; m < MORPH_MOUTH_TRACKS.length; m += 1) {
    const track = MORPH_MOUTH_TRACKS[m] ?? "closed";
    const at = TRACK_INDEX.get(track) ?? 0;
    const shape = unit01(inputs.shapes?.[track]);
    // Round 6: shape x gain x size, clamped to 1; closed and teeth untouched (their gain is 1 and size skips them).
    const v = GAIN_SET.has(track) ? Math.min(1, shape * (gain[m] ?? 1) * size) : shape;
    values[at] = v;
    sum += v;
  }
  if (sum > 1) for (const track of MORPH_MOUTH_TRACKS) values[TRACK_INDEX.get(track) ?? 0] = (values[TRACK_INDEX.get(track) ?? 0] ?? 0) / sum;
  const gaze = inputs.gaze;
  if (gaze !== undefined) {
    const r = unit01(inputs.face.gaze.range) / MORPH_GAZE_FULL;
    const gx = signed(gaze.x * r);
    const gy = signed(gaze.y * r);
    values[TRACK_INDEX.get("gazeL") ?? 0] = Math.max(0, -gx);
    values[TRACK_INDEX.get("gazeR") ?? 0] = Math.max(0, gx);
    values[TRACK_INDEX.get("gazeU") ?? 0] = Math.max(0, -gy);
    values[TRACK_INDEX.get("gazeD") ?? 0] = Math.max(0, gy);
  }
  const strength = unit01(inputs.face.expression.strength);
  const retired = inputs.face.expression.faces;
  const into = EMOTION_FAMILY[inputs.emotion];
  const from = inputs.mood === undefined ? into : EMOTION_FAMILY[inputs.mood.from];
  const m = inputs.mood === undefined ? 1 : smoothstep(inputs.mood.mix);
  addFace(values, from, 1 - m, strength, retired);
  addFace(values, into, m, strength, retired);
}

/** A family's share of the mood crossfade into its track value (none when neutral or retired). */
function addFace(values: Float64Array, family: ExpressionFamily | null, weight: number, strength: number, retired: ResolvedFace["expression"]["faces"]): void {
  if (family === null || !(weight > 0) || retired[family] === "procedural") return;
  const at = TRACK_INDEX.get(family) ?? 0;
  values[at] = Math.min(1, (values[at] ?? 0) + weight * strength);
}

/** The stop rule (module header) for one track's keys at value `v`, into `weights`. */
function stopWeights(keys: Int32Array, at: Float64Array, v: number, weights: Float64Array): void {
  const n = keys.length;
  if (n === 0 || !(v > 0)) return;
  const last = at[n - 1] ?? 1;
  if (v >= last) {
    weights[keys[n - 1] ?? 0] = 1;
    return;
  }
  let lo = 0;
  for (let j = 0; j < n; j += 1) {
    const hi = at[j] ?? 1;
    if (v < hi) {
      const w = hi > lo ? (v - lo) / (hi - lo) : 1;
      weights[keys[j] ?? 0] = w;
      if (j >= 1) weights[keys[j - 1] ?? 0] = 1 - w;
      return;
    }
    lo = hi;
  }
}

/**
 * The active list of `plan` from its `weights` (module header: threshold, cap, order); weights of
 * keys left out are set to 0. Call it after changing `plan.weights` by hand (a capture that forces
 * a key's weight).
 */
export function selectMorphKeys(plan: MorphPlan): MorphPlan {
  const { weights, active } = plan;
  const { order } = indexOf(plan.morph);
  const n = weights.length;
  if (scratch.length < n) scratch = new Uint8Array(n);
  let left = 0;
  for (let i = 0; i < n; i += 1) {
    const on = (weights[i] ?? 0) > MORPH_MIN_WEIGHT ? 1 : 0;
    scratch[i] = on;
    if (on === 0) weights[i] = 0;
    left += on;
  }
  while (left > MORPH_MAX_ACTIVE) {
    // The lowest weight goes; on a tie, the one later in compositing order.
    let drop = -1;
    for (let k = 0; k < order.length; k += 1) {
      const i = order[k] ?? 0;
      if (scratch[i] === 1 && (drop < 0 || (weights[i] ?? 0) <= (weights[drop] ?? 0))) drop = i;
    }
    scratch[drop] = 0;
    weights[drop] = 0;
    left -= 1;
  }
  let count = 0;
  for (let k = 0; k < order.length && count < MORPH_MAX_ACTIVE; k += 1) {
    const i = order[k] ?? 0;
    if (scratch[i] === 1) active[count++] = i;
  }
  plan.count = count;
  return plan;
}

/** This frame's plan for `morph` (module header). The same object every call for one morph. */
export function morphPlan(morph: RigMorph, inputs: MorphInputs): MorphPlan {
  const plan = planOf(morph);
  const { stops, kind, gain } = indexOf(morph);
  const { values, weights, colour } = plan;
  trackValues(inputs, gain, values);
  for (let n = 0; n < stops.length; n += 1) {
    const s = stops[n];
    if (s !== undefined) stopWeights(s.keys, s.at, values[s.track] ?? 0, weights);
  }
  const speak = unit01(inputs.speak);
  // The six family tracks come first in MORPH_TRACKS.
  let expression = 0;
  for (let t = 0; t < EXPRESSION_FAMILIES.length; t += 1) expression += values[t] ?? 0;
  const eyes = 1 - Math.min(1, expression);
  for (let i = 0; i < weights.length; i += 1) {
    const k = kind[i];
    if (k === 1) {
      colour[i] = 1 - speak;
      weights[i] = (weights[i] ?? 0) * (1 - 0.5 * speak);
    } else if (k === 2 || k === 3) {
      // The gaze's field was measured on the neutral eye: on an expression's lids it smears them, so it yields too.
      // So does an early blink stop: its neutral, still-open eye would replace a narrowed expression's eye.
      colour[i] = eyes;
      weights[i] = (weights[i] ?? 0) * eyes;
    }
  }
  return selectMorphKeys(plan);
}

/** The plan with no key active (every weight 0), for a capture that sets weights by hand. */
export function emptyMorphPlan(morph: RigMorph): MorphPlan {
  return planOf(morph);
}
