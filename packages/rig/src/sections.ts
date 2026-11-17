// The optional Rig sections (challenge-2026-11-17 rig/A), one row each in contract order: how a
// section is read from undecoded data and how it is written. validateRig reads every row,
// serializeRig writes every row, readLook reads the rows a look carries (LOOK_SECTIONS). A new
// section is one row here (plus its field on `Rig` in types.ts and its doc in docs/rig-format.md).
import { readFace, wireFace } from "./face.js";
import { sectionRead, type SectionRead } from "./read.js";
import type { Rig } from "./types.js";
import { readMorph, wireMorph } from "./validateMorph.js";
import { readMouth, wireMouth } from "./validateMouth.js";
import { readRigMotion, readRigTurn, wireRigMotion, wireRigTurn, type MotionCanvas } from "./validateMotion.js";

export type RigSectionKey = "mouth" | "face" | "motion" | "turn" | "morph";
/** The optional sections of a Rig, every one of them omitted when absent. */
export type RigSections = Pick<Rig, RigSectionKey>;
type Value<K extends RigSectionKey> = NonNullable<Rig[K]>;

export interface RigSection<K extends RigSectionKey> {
  /** The section at `path` (`$.<key>`); absent is `{ problems: [] }`. `canvas` bounds what depends on it. */
  read(value: unknown, path: string, canvas?: MotionCanvas): SectionRead<Value<K>>;
  /** A fresh copy in contract order, fields outside the contract dropped. */
  wire(value: Value<K>): Value<K>;
}

export const RIG_SECTIONS: { readonly [K in RigSectionKey]: RigSection<K> } = {
  mouth: { read: (value, path, canvas) => readMouth(value, path, canvas), wire: wireMouth },
  face: {
    read: (value, path) => {
      const { face, problems } = readFace(value, path);
      return face === undefined ? { problems } : { value: face, problems };
    },
    wire: wireFace,
  },
  motion: {
    read: (value, path) => {
      const { motion, problems } = readRigMotion(value, path);
      return sectionRead(motion, problems);
    },
    wire: wireRigMotion,
  },
  turn: {
    read: (value, path) => {
      const { turn, problems } = readRigTurn(value, path);
      return sectionRead(turn, problems);
    },
    wire: wireRigTurn,
  },
  morph: {
    read: (value, path, canvas) => {
      const { morph, problems } = readMorph(value, path, canvas?.width);
      return sectionRead(morph, problems);
    },
    wire: wireMorph,
  },
};

/** The section keys, in contract order. */
export const RIG_SECTION_KEYS = Object.keys(RIG_SECTIONS) as RigSectionKey[];

/** The sections a stored look carries (Look.face, Look.motion, Look.turn), read with the rig's readers. */
export const LOOK_SECTIONS = ["face", "motion", "turn"] as const satisfies readonly RigSectionKey[];

function readOne<K extends RigSectionKey>(key: K, fields: Record<string, unknown>, canvas: MotionCanvas | undefined, out: RigSections): SectionRead<Value<K>>["problems"] {
  const read = RIG_SECTIONS[key].read(fields[key], `$.${key}`, canvas);
  if (read.value !== undefined) out[key] = read.value;
  return read.problems;
}

/** Reads `keys` (every section by default) off a decoded object: the good ones, and every problem in key order. */
export function readSections(fields: Record<string, unknown>, canvas?: MotionCanvas, keys: readonly RigSectionKey[] = RIG_SECTION_KEYS): SectionRead<RigSections> & { value: RigSections } {
  const value: RigSections = {};
  const problems = keys.flatMap((key) => readOne(key, fields, canvas, value));
  return { value, problems };
}

function wireOne<K extends RigSectionKey>(key: K, rig: RigSections, out: RigSections): void {
  const value = rig[key];
  if (value !== undefined) out[key] = RIG_SECTIONS[key].wire(value);
}

/** Every present section of `rig`, wired, in contract order. */
export function wireSections(rig: RigSections): RigSections {
  const out: RigSections = {};
  for (const key of RIG_SECTION_KEYS) wireOne(key, rig, out);
  return out;
}
