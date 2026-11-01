// CH 9, lights out (costume task 5.2, r1/sealed-c.html): the pure half. The tube's glass inside the
// crt-frontal plate (the landing's superellipse, in the plate's 1200 x 896 space), when a release
// of the knob counts as switching the set off, and how strongly the Announcer shows in the black
// glass after the n-th switch-off: a little more each time, never fully there.
import type { CSSProperties } from "react";
import { clipPolygon, GLASS, PLATE, superellipse } from "../landing/superellipse";

/** The glass in its own box (2a x 2b), so the clip fills an element of the glass's aspect. */
export const GLASS_CLIP = clipPolygon(superellipse({ ...GLASS, cx: GLASS.a, cy: GLASS.b }, 96), {
  width: 2 * GLASS.a,
  height: 2 * GLASS.b,
});

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/** The glass box inside the plate, as percentages of the plate (CSS variables for the module). */
export const GLASS_IN_PLATE: CSSProperties & Record<`--${string}`, string> = {
  "--glass-x": pct((GLASS.cx - GLASS.a) / PLATE.width),
  "--glass-y": pct((GLASS.cy - GLASS.b) / PLATE.height),
  "--glass-w": pct((2 * GLASS.a) / PLATE.width),
  "--glass-h": pct((2 * GLASS.b) / PLATE.height),
};

/** Pure: a point in the set (percent of the plate) mapped into the glass box (percent of the glass). */
export function toGlass(x: number, y: number): { x: number; y: number } {
  const gx = (GLASS.cx - GLASS.a) / PLATE.width;
  const gy = (GLASS.cy - GLASS.b) / PLATE.height;
  const gw = (2 * GLASS.a) / PLATE.width;
  const gh = (2 * GLASS.b) / PLATE.height;
  return { x: ((x / 100 - gx) / gw) * 100, y: ((y / 100 - gy) / gh) * 100 };
}

/** A tube held on at least this long is warm enough to hold an afterimage when it goes dark. */
export const WARM_MS = 700;

/** Pure: does letting go after `heldMs` count as switching the set off (the glass shows something)? */
export function isSwitchOff(heldMs: number): boolean {
  return Number.isFinite(heldMs) && heldMs >= WARM_MS;
}

export interface Reflection {
  /** Peak opacity of the Announcer in the black glass, 0 (never switched off) .. below 0.5. */
  peak: number;
  /** Width of the reflection as a share of the glass, 0 .. below 0.82. */
  width: number;
}

/**
 * Pure: the Announcer's reflection after `switchOffs` switch-offs. Nothing before the first; from
 * then on, every switch-off brings it closer (strictly stronger and larger), never fully there.
 */
export function reflection(switchOffs: number): Reflection {
  const n = Number.isFinite(switchOffs) ? Math.floor(switchOffs) : 0;
  if (n <= 0) return { peak: 0, width: 0 };
  return { peak: 0.5 - 0.24 * 0.78 ** (n - 1), width: 0.82 - 0.2 * 0.85 ** (n - 1) };
}
