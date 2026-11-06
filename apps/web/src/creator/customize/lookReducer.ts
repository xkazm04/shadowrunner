// The look reducer (creator design.md "Contracts"): every customisation is a LookAction applied
// to the current Look. Pure and non-mutating; the stage re-renders from the returned Look.
//
// Decisions the spec leaves open:
// - Palette values are kept as lower-case "#rrggbb". A value that is not a 6-digit hex colour
//   (any case, with or without "#") is refused: the look comes back unchanged (same object).
// - `look.hidden` is kept sorted and without duplicates, so a toggle is its own inverse exactly
//   (toggling twice returns an equal look) and two looks that hide the same parts compare equal.
// - Choosing an emotion clears a pinned `look.gesture`, so the emotion's own default gesture
//   (resolveGesture) applies again.
// - Region colours and part shapes (character-control "Creator UI") are omitted when absent: a
//   region reset deletes its key, a shape that clamps to identity deletes its layer, and an empty
//   map deletes the field, so an untouched look stays exactly `defaultLook`. A region value that is
//   not a hex colour is refused like a palette one.
// - The face profile (face-control "Face" tab) is kept minimal: a field set to the character's own
//   value (Rig.face, else FACE_DEFAULTS) is deleted, as is an empty `look.face`, so an untouched
//   face leaves no trace and the character's own profile shows through. A value outside FACE_LIMITS
//   is clamped; one that is not a finite number is refused (same look back).
import {
  clampShape,
  defaultLook,
  FACE_DEFAULTS,
  FACE_LIMITS,
  faceValue,
  isIdentityShape,
  withFaceValue,
  type Emotion,
  type FaceField,
  type Look,
  type Palette,
  type PartShape,
  type Rig,
} from "@sr/rig";

export type LookAction =
  | { type: "palette"; key: keyof Palette; value: string }
  | { type: "toggle"; layer: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "reset"; rig: Rig }
  /** `key` is `regionKey(layer, slot)`; a null or omitted value resets the region to its paint. */
  | { type: "region"; key: string; value?: string | null }
  | { type: "shape"; layer: string; value: Partial<PartShape> }
  | { type: "shapeReset"; layer: string }
  | { type: "shapeResetAll" }
  /** One face profile field set over `rig`'s own profile. */
  | { type: "face"; field: FaceField; value: number; rig: Pick<Rig, "face"> }
  /** Back to the character's own profile: `look.face` deleted. */
  | { type: "faceReset" };

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#RRGGBB", "rrggbb" -> "#rrggbb"; undefined for anything else. */
export function normalizeHex(value: string): string | undefined {
  const m = HEX.exec(value.trim());
  return m?.[1] === undefined ? undefined : `#${m[1].toLowerCase()}`;
}

const copy = (look: Look): Look => {
  const out: Look = { palette: { ...look.palette }, hidden: [...look.hidden], emotion: look.emotion };
  if (look.gesture !== undefined) out.gesture = look.gesture;
  if (look.regions !== undefined) out.regions = { ...look.regions };
  if (look.shape !== undefined) out.shape = Object.fromEntries(Object.entries(look.shape).map(([k, v]) => [k, { ...v }]));
  if (look.face !== undefined) out.face = structuredClone(look.face);
  return out;
};

/** `look` with `regions` / `shape` set to the maps given, each left out when it is empty. */
function withMaps(look: Look, regions: Look["regions"], shape: Look["shape"]): Look {
  const next = copy(look);
  delete next.regions;
  delete next.shape;
  if (regions !== undefined && Object.keys(regions).length > 0) next.regions = { ...regions };
  if (shape !== undefined && Object.keys(shape).length > 0) next.shape = shape;
  return next;
}

/** `map` without `key`. */
const without = <T>(map: Readonly<Record<string, T>> | undefined, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key));

const sortedUnique = (names: readonly string[]): string[] => [...new Set(names)].sort();

export function lookReducer(look: Look, action: LookAction): Look {
  switch (action.type) {
    case "palette": {
      const value = normalizeHex(action.value);
      if (value === undefined) return look;
      const next = copy(look);
      next.palette[action.key] = value;
      return next;
    }
    case "toggle": {
      const next = copy(look);
      const hidden = new Set(look.hidden);
      if (hidden.has(action.layer)) hidden.delete(action.layer);
      else hidden.add(action.layer);
      next.hidden = sortedUnique([...hidden]);
      return next;
    }
    case "emotion": {
      const next = copy(look);
      next.emotion = action.emotion;
      delete next.gesture;
      return next;
    }
    case "reset":
      return defaultLook(action.rig);
    case "region": {
      if (action.value === undefined || action.value === null) {
        if (look.regions?.[action.key] === undefined) return look;
        return withMaps(look, without(look.regions, action.key), look.shape);
      }
      const value = normalizeHex(action.value);
      if (value === undefined) return look;
      return withMaps(look, { ...look.regions, [action.key]: value }, look.shape);
    }
    case "shape": {
      const value = clampShape({ ...look.shape?.[action.layer], ...action.value });
      const rest = without(look.shape, action.layer);
      return withMaps(look, look.regions, isIdentityShape(value) ? rest : { ...rest, [action.layer]: value });
    }
    case "shapeReset":
      return look.shape?.[action.layer] === undefined ? look : withMaps(look, look.regions, without(look.shape, action.layer));
    case "shapeResetAll":
      return look.shape === undefined ? look : withMaps(look, look.regions, undefined);
    case "face": {
      if (!Number.isFinite(action.value)) return look;
      const [min, max] = FACE_LIMITS[action.field];
      const value = Math.min(max, Math.max(min, action.value));
      const own = faceValue(action.rig.face, action.field) ?? faceValue(FACE_DEFAULTS, action.field);
      const face = withFaceValue(look.face, action.field, value === own ? undefined : value);
      const next = copy(look);
      delete next.face;
      if (Object.keys(face).length > 0) next.face = face;
      return next;
    }
    case "faceReset": {
      if (look.face === undefined) return look;
      const next = copy(look);
      delete next.face;
      return next;
    }
  }
}
