// What changed in a look since it was opened (rig/B, challenge-2026-11-17): the creator's Compare
// lists these changes and reverts any one of them alone. Pure, no DOM; never modifies its inputs.
//
// - `lookChanges(rig, from, to)` names every difference, one per palette key, hidden layer, region
//   key, shape layer, face field (FACE_FIELDS, then each retired family as
//   `expression.faces.<family>`), and for emotion, gesture, `motion.spring`, `turn.warp` and
//   `turn.light`. The order is fixed (that list, keys sorted within an area), so a change keeps its
//   place when another is reverted. A side where the key is absent has no `before` / `after`
//   (omitted, never undefined); a hidden layer's values are booleans (hidden or not), a retired
//   family's too.
// - `revertChange(look, from, change)` sets that one key back to `from`'s value (deleting it when
//   `from` has none) and leaves every other key as it is; maps left empty are left out, as the
//   creator's reducer keeps them.
// - `sameLook(a, b)`: structural equality over the same fields, blind to key order and to the order
//   of `hidden`; true exactly when `lookChanges` finds nothing.
import { EXPRESSION_FAMILIES } from "./control.js";
import { FACE_FIELDS, faceValue, withFaceValue, withRetired } from "./face.js";
import type { ExpressionFamily, Look, Palette, PartShape, Rig, RigFace } from "./types.js";

export type LookArea = "palette" | "hidden" | "emotion" | "gesture" | "region" | "shape" | "face" | "motion" | "turn";

/** A value on one side of a change: a colour or name, a number, hidden-or-not, or a part shape. */
export type LookValue = string | number | boolean | PartShape;

export interface LookChange {
  area: LookArea;
  /** The palette key, layer name, region key (`layer/slot`), dotted face path, or `emotion` / `gesture` / `motion.spring` / `turn.warp` / `turn.light`. */
  key: string;
  /** For people: "Eye colour", "horn: Horn tip", "Gaze range". */
  label: string;
  /** The value as opened; omitted when the key was absent. */
  before?: LookValue;
  /** The value now; omitted when the key is absent. */
  after?: LookValue;
}

const PALETTE_KEYS: readonly (keyof Palette)[] = ["glow", "eye", "rim", "mouth"];
const TURN_KEYS = ["warp", "light"] as const;

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** "saccadeRate" -> "saccade rate", "eye_l" -> "eye l". */
const words = (s: string): string => s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

const sameValue = (a: LookValue | undefined, b: LookValue | undefined): boolean => {
  if (typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => Reflect.get(a, k) === Reflect.get(b, k));
  }
  return a === b;
};

function change(area: LookArea, key: string, label: string, before: LookValue | undefined, after: LookValue | undefined): LookChange[] {
  if (sameValue(before, after)) return [];
  return [{ area, key, label, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }];
}

const sortedKeys = (...maps: (Readonly<Record<string, unknown>> | undefined)[]): string[] => [...new Set(maps.flatMap((m) => Object.keys(m ?? {})))].sort();

const isRetired = (face: RigFace | undefined, family: ExpressionFamily): boolean => face?.expression?.faces?.[family] === "procedural";

function regionLabel(rig: Pick<Rig, "layers"> | undefined, key: string): string {
  const cut = key.indexOf("/");
  const [layer, slot] = cut < 0 ? [key, ""] : [key.slice(0, cut), key.slice(cut + 1)];
  const name = rig?.layers.find((l) => l.name === layer)?.regions?.slots.find((s) => s.id === slot)?.name ?? slot;
  return `${words(layer)}: ${name}`;
}

function diff(rig: Pick<Rig, "layers"> | undefined, from: Look, to: Look): LookChange[] {
  const out: LookChange[] = [];
  for (const key of PALETTE_KEYS) out.push(...change("palette", key, `${title(key)} colour`, from.palette[key], to.palette[key]));
  const [hiddenFrom, hiddenTo] = [new Set(from.hidden), new Set(to.hidden)];
  for (const layer of [...new Set([...hiddenFrom, ...hiddenTo])].sort()) out.push(...change("hidden", layer, words(layer), hiddenFrom.has(layer), hiddenTo.has(layer)));
  out.push(...change("emotion", "emotion", "Mood", from.emotion, to.emotion));
  out.push(...change("gesture", "gesture", "Gesture", from.gesture, to.gesture));
  for (const key of sortedKeys(from.regions, to.regions)) out.push(...change("region", key, regionLabel(rig, key), from.regions?.[key], to.regions?.[key]));
  for (const layer of sortedKeys(from.shape, to.shape)) out.push(...change("shape", layer, `${words(layer)} shape`, from.shape?.[layer], to.shape?.[layer]));
  for (const field of FACE_FIELDS) out.push(...change("face", field, title(words(field.split(".").slice(-2).join(" "))), faceValue(from.face, field), faceValue(to.face, field)));
  for (const family of EXPRESSION_FAMILIES) {
    out.push(...change("face", `expression.faces.${family}`, `${title(family)} face retired`, isRetired(from.face, family), isRetired(to.face, family)));
  }
  out.push(...change("motion", "motion.spring", "Spring", from.motion?.spring, to.motion?.spring));
  for (const key of TURN_KEYS) out.push(...change("turn", `turn.${key}`, `Turn ${key}`, from.turn?.[key], to.turn?.[key]));
  return out;
}

/** Every change from `from` to `to`, in a fixed order; labels name `rig`'s region slots. */
export function lookChanges(rig: Pick<Rig, "layers">, from: Look, to: Look): LookChange[] {
  return diff(rig, from, to);
}

/** Structural equality of two looks (key order and `hidden` order ignored). */
export function sameLook(a: Look, b: Look): boolean {
  return a === b || diff(undefined, a, b).length === 0;
}

/** `map` with `key` set to `value` (or removed); undefined when nothing is left. */
function setKey<T>(map: Readonly<Record<string, T>> | undefined, key: string, value: T | undefined): Record<string, T> | undefined {
  const out = Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key));
  if (value !== undefined) out[key] = value;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** `look` with `field` set to `value`, the field left out when the value is undefined. */
function withField<K extends "gesture" | "regions" | "shape" | "face" | "motion" | "turn">(look: Look, field: K, value: Look[K] | undefined): Look {
  const next: Look = { ...look };
  if (value !== undefined) next[field] = value;
  else if (field === "gesture") delete next.gesture;
  else if (field === "regions") delete next.regions;
  else if (field === "shape") delete next.shape;
  else if (field === "face") delete next.face;
  else if (field === "motion") delete next.motion;
  else delete next.turn;
  return next;
}

function revertFace(face: RigFace | undefined, from: RigFace | undefined, key: string): RigFace | undefined {
  const family = EXPRESSION_FAMILIES.find((f) => key === `expression.faces.${f}`);
  const field = FACE_FIELDS.find((f) => f === key);
  const next = family !== undefined ? withRetired(face, family, isRetired(from, family)) : field !== undefined ? withFaceValue(face, field, faceValue(from, field)) : face;
  return next === undefined || Object.keys(next).length === 0 ? undefined : next;
}

/** `look` with `change` set back to `from`'s value; every other key as it is. */
export function revertChange(look: Look, from: Look, change: Pick<LookChange, "area" | "key">): Look {
  const { key } = change;
  switch (change.area) {
    case "palette": {
      const k = PALETTE_KEYS.find((p) => p === key);
      return k === undefined ? look : { ...look, palette: { ...look.palette, [k]: from.palette[k] } };
    }
    case "hidden": {
      const rest = look.hidden.filter((n) => n !== key);
      return { ...look, hidden: [...new Set(from.hidden.includes(key) ? [...rest, key] : rest)].sort() };
    }
    case "emotion":
      return { ...look, emotion: from.emotion };
    case "gesture":
      return withField(look, "gesture", from.gesture);
    case "region":
      return withField(look, "regions", setKey(look.regions, key, from.regions?.[key]));
    case "shape":
      return withField(look, "shape", setKey(look.shape, key, from.shape?.[key]));
    case "face":
      return withField(look, "face", revertFace(look.face, from.face, key));
    case "motion": {
      const spring = from.motion?.spring;
      return withField(look, "motion", spring === undefined ? undefined : { ...look.motion, spring });
    }
    case "turn": {
      const k = TURN_KEYS.find((t) => `turn.${t}` === key);
      if (k === undefined) return look;
      const value = from.turn?.[k];
      const turn: NonNullable<Look["turn"]> = { ...look.turn, [k]: value };
      if (turn.warp === undefined) delete turn.warp;
      if (turn.light === undefined) delete turn.light;
      return withField(look, "turn", Object.keys(turn).length === 0 ? undefined : turn);
    }
  }
}
