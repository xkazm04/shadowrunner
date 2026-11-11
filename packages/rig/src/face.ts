// The face profile (face-control): defaults, limits, the merge of Rig.face and Look.face, and the
// checked read of a stored profile. Every consumer (the avatar driver and pose, the creator's Face
// panel) reads the profile through `resolveFace`, so defaults live in exactly one place.
//
// retire-a-face: `expression.faces` names families whose painted face is retired to procedural
// motion. It is not a number, so it is not a FACE_FIELDS entry: `readFace` reads it on its own,
// `withRetired` sets it, and `resolveFace` takes the union of Rig.face's and Look.face's (a look can
// retire a family the rig paints; it cannot bring back one the rig itself retired).
import { EXPRESSION_FAMILIES } from "./control.js";
import type { ExpressionFamily, Look, RetiredFaces, Rig, RigFace } from "./types.js";

/** A profile with every field filled. */
export interface ResolvedFace {
  gaze: { range: number; saccadeRate: number; habits: { chat: number; content: number; host: number } };
  motion: { drift: number; tilt: number; gesture: number; breath: number };
  /** `faces`: every retired family (Rig.face's and Look.face's), `{}` when none is. */
  expression: { strength: number; faces: RetiredFaces };
  /** `size` (round 6): the morph plan's speaking-mouth multiplier; nothing else reads it. */
  mouth: { emotion: number; size: number };
}

export const FACE_DEFAULTS: ResolvedFace = {
  gaze: { range: 0.6, saccadeRate: 1.2, habits: { chat: 1, content: 1, host: 1 } },
  motion: { drift: 1, tilt: 1, gesture: 1, breath: 0.3 },
  expression: { strength: 1, faces: {} },
  mouth: { emotion: 1, size: 1 },
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
  "mouth.size": [0.3, 1],
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
    expression: { strength: pick("expression.strength"), faces: { ...retiredOf(rig?.face), ...retiredOf(look?.face) } },
    mouth: { emotion: pick("mouth.emotion"), size: pick("mouth.size") },
  };
}

/** The families `face` retires, read leniently (anything but `"procedural"` on a known family is ignored). */
function retiredOf(face: RigFace | undefined): RetiredFaces {
  const faces: unknown = isRecord(face) && isRecord(face.expression) ? face.expression.faces : undefined;
  const out: RetiredFaces = {};
  if (!isRecord(faces)) return out;
  for (const family of EXPRESSION_FAMILIES) if (faces[family] === "procedural") out[family] = "procedural";
  return out;
}

/** Whether `family`'s painted face is retired in a resolved profile. */
export const isRetired = (face: Pick<ResolvedFace, "expression">, family: ExpressionFamily): boolean => face.expression.faces[family] === "procedural";

/**
 * `face` with `family` retired (or restored), a new object. Families stay in EXPRESSION_FAMILIES
 * order; an empty `faces`, `expression` or profile is left out (`{}` when nothing is left).
 */
export function withRetired(face: RigFace | undefined, family: ExpressionFamily, retired: boolean): RigFace {
  const base: RigFace = isRecord(face) ? (JSON.parse(JSON.stringify(face)) as RigFace) : {};
  const now = retiredOf(base);
  const faces: RetiredFaces = {};
  for (const f of EXPRESSION_FAMILIES) if (f === family ? retired : now[f] !== undefined) faces[f] = "procedural";
  const expression = { ...base.expression };
  delete expression.faces;
  if (Object.keys(faces).length > 0) expression.faces = faces;
  delete base.expression;
  if (Object.keys(expression).length > 0) base.expression = expression;
  return base;
}

export interface FaceProblem {
  path: string;
  message: string;
}

/**
 * A stored profile: every known field that is a finite number inside its limits is kept, anything
 * else is reported (`problems`) and dropped; so is an `expression.faces` entry that is not
 * `"procedural"`. Unknown keys (and unknown families) are dropped silently. Undefined when nothing is
 * left.
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
  const faces: unknown = isRecord(value.expression) ? value.expression.faces : undefined;
  if (faces !== undefined && !isRecord(faces)) problems.push({ path: `${path}.expression.faces`, message: `${path}.expression.faces: expected an object of family -> "procedural"` });
  if (isRecord(faces)) {
    for (const family of EXPRESSION_FAMILIES) {
      const v = faces[family];
      if (v === undefined) continue;
      if (v === "procedural") face = withRetired(face, family, true);
      else problems.push({ path: `${path}.expression.faces.${family}`, message: `${path}.expression.faces.${family}: expected "procedural"` });
    }
  }
  return face === undefined || Object.keys(face).length === 0 ? { problems } : { face, problems };
}
