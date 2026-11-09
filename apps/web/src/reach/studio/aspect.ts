// The take's size (perfection-pass task 6, requirement 6.3): "as shown" (the on-screen canvas,
// the studio's first behaviour and the default) or a preset that is independent of the screen.
//
// Framing rule for a preset: the rig's whole canvas is fitted inside the frame (contain, so no
// part of the character, face included, is ever cropped), centred across and standing on the
// frame's bottom edge, as a bust stands on a stage. 1:1 fills the frame; 16:9 leaves the sides to
// the background; 9:16 puts the headroom above the head, never a band under the cut-off body.
// The character is drawn at that rect's own pixel size (a second player, resize(w, h, 1)), never
// scaled up from the screen.

export type AspectId = "shown" | "square" | "portrait" | "landscape";

export interface Aspect {
  id: AspectId;
  label: string;
  /** Absent for "as shown". */
  size?: { width: number; height: number };
}

export const ASPECTS: readonly Aspect[] = [
  { id: "shown", label: "As shown" },
  { id: "square", label: "1:1 (1080 × 1080)", size: { width: 1080, height: 1080 } },
  { id: "portrait", label: "9:16 (1080 × 1920)", size: { width: 1080, height: 1920 } },
  { id: "landscape", label: "16:9 (1920 × 1080)", size: { width: 1920, height: 1080 } },
];

export const aspectOf = (id: AspectId): Aspect => ASPECTS.find((a) => a.id === id) ?? { id: "shown", label: "As shown" };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a `rig` (its canvas size) is drawn in a `frame` (see the header), whole pixels. */
export function placeRig(rig: { width: number; height: number }, frame: { width: number; height: number }): Rect {
  const scale = rig.width > 0 && rig.height > 0 ? Math.min(frame.width / rig.width, frame.height / rig.height) : 1;
  const width = Math.max(1, Math.round(rig.width * scale));
  const height = Math.max(1, Math.round(rig.height * scale));
  return { x: Math.round((frame.width - width) / 2), y: frame.height - height, width, height };
}
