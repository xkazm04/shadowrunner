// The face profile (face-control): defaults, limits, the merge of Rig.face and Look.face, and the
// checked read of a stored profile. Every consumer (the avatar driver and pose, the creator's Face
// panel) reads the profile through `resolveFace`, so defaults live in exactly one place.
import type { Look, Rig, RigFace } from "./types.js";

/** A profile with every field filled. */
export interface ResolvedFace {
  gaze: { range: number; saccadeRate: number; habits: { chat: number; content: number; host: number } };
  motion: { drift: number; tilt: number; gesture: number; breath: number };
  expression: { strength: number };
  mouth: { emotion: number };
}

export const FACE_DEFAULTS: ResolvedFace = {
  gaze: { range: 0.6, saccadeRate: 1.2, habits: { chat: 1, content: 1, host: 1 } },
  motion: { drift: 1, tilt: 1, gesture: 1, breath: 0.3 },
  expression: { strength: 1 },
  mouth: { emotion: 1 },
};

/** [min, max] of each field, by dotted path. */
export const FACE_LIMITS = {
  "gaze.range": [0, 1],
  "gaze.saccadeRate": [0, 4],
  "gaze.habits.chat": [0, 1],
  "gaze.habits.content": [0, 1],
  "gaze.habits.host": [0, 1],
  "motion.drift": [0, 2],
  "motion.tilt": [0, 2],
  "motion.gesture": [0, 2],
  "motion.breath": [0, 1],
  "expression.strength": [0, 1],
  "mouth.emotion": [0, 1.5],
} as const satisfies Record<string, readonly [number, number]>;

export type FaceField = keyof typeof FACE_LIMITS;

export const FACE_FIELDS = Object.keys(FACE_LIMITS) as FaceField[];

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value at a dotted path of a (partial) profile, or undefined. */
export function faceValue(face: RigFace | ResolvedFace | undefined, field: FaceField): number | undefined {
  let at: unknown = face;
  for (const key of field.split(".")) at = isRecord(at) ? at[key] : undefined;
  return typeof at === "number" && Number.isFinite(at) ? at : undefined;
}

/** `face` with the value at `field` set (a new object; `undefined` removes the key). */
export function withFaceValue(face: RigFace | undefined, field: FaceField, value: number | undefined): RigFace {
  return (setPath(isRecord(face) ? face : {}, field.split("."), value) ?? {}) as RigFace;
}

/** A copy of `node` with `keys` set to `value` (or removed), empty groups left out; undefined when empty. */
function setPath(node: Fields, keys: string[], value: number | undefined): Fields | undefined {
  const [key, ...rest] = keys;
  if (key === undefined) return node;
  const child = node[key];
  const next = rest.length === 0 ? value : setPath(isRecord(child) ? child : {}, rest, value);
  const out = Object.fromEntries(Object.entries(node).filter(([k]) => k !== key));
  if (next !== undefined) out[key] = next;
  return Object.keys(out).length === 0 ? undefined : out;
}

const clamp = (field: FaceField, v: number): number => Math.min(FACE_LIMITS[field][1], Math.max(FACE_LIMITS[field][0], v));

/** The profile in force: Look.face over Rig.face over FACE_DEFAULTS, each field clamped to FACE_LIMITS. */
export function resolveFace(rig: Pick<Rig, "face"> | undefined, look?: Pick<Look, "face">): ResolvedFace {
  const pick = (field: FaceField): number =>
    clamp(field, faceValue(look?.face, field) ?? faceValue(rig?.face, field) ?? (faceValue(FACE_DEFAULTS, field) as number));
  return {
    gaze: {
      range: pick("gaze.range"),
      saccadeRate: pick("gaze.saccadeRate"),
      habits: { chat: pick("gaze.habits.chat"), content: pick("gaze.habits.content"), host: pick("gaze.habits.host") },
    },
    motion: { drift: pick("motion.drift"), tilt: pick("motion.tilt"), gesture: pick("motion.gesture"), breath: pick("motion.breath") },
    expression: { strength: pick("expression.strength") },
    mouth: { emotion: pick("mouth.emotion") },
  };
}

export interface FaceProblem {
  path: string;
  message: string;
}

/**
 * A stored profile: every known field that is a finite number inside its limits is kept, anything
 * else is reported (`problems`) and dropped. Unknown keys are dropped silently. Undefined when
 * nothing is left.
 */
export function readFace(value: unknown, path: string): { face?: RigFace; problems: FaceProblem[] } {
  if (value === undefined) return { problems: [] };
  if (!isRecord(value)) return { problems: [{ path, message: `${path}: expected a face profile object` }] };
  const problems: FaceProblem[] = [];
  let face: RigFace | undefined;
  for (const field of FACE_FIELDS) {
    let at: unknown = value;
    for (const key of field.split(".")) at = isRecord(at) ? at[key] : undefined;
    if (at === undefined) continue;
    const [min, max] = FACE_LIMITS[field];
    if (typeof at !== "number" || !Number.isFinite(at) || at < min || at > max) {
      problems.push({ path: `${path}.${field}`, message: `${path}.${field}: expected a number in [${min}, ${max}]` });
      continue;
    }
    face = withFaceValue(face, field, at);
  }
  return face === undefined ? { problems } : { face, problems };
}
