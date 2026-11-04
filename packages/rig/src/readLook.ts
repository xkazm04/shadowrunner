// The checked read of a stored or shipped look (moved from the web library for avatar-pack, design
// "readLook moves to @sr/rig"): the library reads saved looks with it and @sr/pack reads a pack's
// manifest look with it. Rig cannot import @sr/engine, so emotions and gestures are checked here
// against rig-owned lists (EMOTION_TABLE keys, GESTURE_NAMES); an engine test pins them equal.
import { EMOTION_TABLE } from "./look.js";
import type { Emotion, Gesture, Look, Palette, PartShape, Rig } from "./types.js";
import { validateLookControls } from "./validateControl.js";

/** Every `Gesture`, as a runtime list. */
export const GESTURE_NAMES = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"] as const satisfies readonly Gesture[];

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const PALETTE_KEYS: readonly (keyof Palette)[] = ["glow", "eye", "rim", "mouth"];
const GESTURE_LIST: readonly string[] = GESTURE_NAMES;

/** A string key of EMOTION_TABLE. */
export const isLookEmotion = (v: unknown): v is Emotion => typeof v === "string" && Object.hasOwn(EMOTION_TABLE, v);

/** One of GESTURE_NAMES. */
export const isLookGesture = (v: unknown): v is Gesture => typeof v === "string" && GESTURE_LIST.includes(v);

/**
 * The entries of a stored look's `regions` or `shape` that `validateLookControls` passes, one by
 * one (character-control): an invalid entry is dropped, never the whole look. Undefined when none
 * is left.
 */
function readControls<T>(field: "regions" | "shape", value: unknown, rig: Rig | undefined): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  const kept = Object.entries(value).filter(([key, item]) => validateLookControls({ [field]: { [key]: item } }, rig).length === 0);
  return kept.length === 0 ? undefined : (Object.fromEntries(kept) as Record<string, T>);
}

/**
 * A stored look, or undefined when any of its base fields is off. Its region colours and part
 * shapes are checked entry by entry (against `rig` when given) and the bad ones dropped.
 */
export function readLook(value: unknown, rig?: Rig): Look | undefined {
  if (!isRecord(value) || !isRecord(value.palette) || !Array.isArray(value.hidden) || !isLookEmotion(value.emotion)) return undefined;
  const palette = value.palette;
  const read = (key: keyof Palette): string | undefined => {
    const v = palette[key];
    return typeof v === "string" && HEX.test(v) ? v : undefined;
  };
  const [glow, eye, rim, mouth] = PALETTE_KEYS.map(read);
  if (glow === undefined || eye === undefined || rim === undefined || mouth === undefined) return undefined;
  if (!value.hidden.every((n): n is string => typeof n === "string")) return undefined;
  const look: Look = { palette: { glow, eye, rim, mouth }, hidden: [...value.hidden], emotion: value.emotion };
  if (value.gesture !== undefined) {
    if (!isLookGesture(value.gesture)) return undefined;
    look.gesture = value.gesture;
  }
  const regions = readControls<string>("regions", value.regions, rig);
  if (regions !== undefined) look.regions = regions;
  const shape = readControls<PartShape>("shape", value.shape, rig);
  if (shape !== undefined) look.shape = shape;
  return look;
}
