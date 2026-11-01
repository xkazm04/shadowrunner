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
import { defaultLook, type Emotion, type Look, type Palette, type Rig } from "@sr/rig";

export type LookAction =
  | { type: "palette"; key: keyof Palette; value: string }
  | { type: "toggle"; layer: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "reset"; rig: Rig };

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#RRGGBB", "rrggbb" -> "#rrggbb"; undefined for anything else. */
export function normalizeHex(value: string): string | undefined {
  const m = HEX.exec(value.trim());
  return m?.[1] === undefined ? undefined : `#${m[1].toLowerCase()}`;
}

const copy = (look: Look): Look => {
  const out: Look = { palette: { ...look.palette }, hidden: [...look.hidden], emotion: look.emotion };
  if (look.gesture !== undefined) out.gesture = look.gesture;
  return out;
};

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
  }
}
