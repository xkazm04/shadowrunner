// The studio's background colour (spec avatar-reach, design "Studio"): a few theme roles as
// swatches plus a free colour input. The recorder paints the colour into every video frame, so a
// swatch is resolved to its computed value (a CSS variable is not a fill style); the colour input
// needs `#rrggbb`, so values are normalised to that.
//
// Decisions the spec leaves open:
// - The swatches are the dark stage surfaces, the accent, the phosphor and the paper roles.
// - A role the page cannot resolve (no theme loaded: tests, prerender) is left off the swatches;
//   the first colour is then black, the only literal here.

/** Theme roles offered as swatches, with their labels. */
export const SWATCH_ROLES: readonly (readonly [role: string, label: string])[] = [
  ["surface-0", "Night"],
  ["surface-2", "Dusk"],
  ["accent", "Accent"],
  ["phosphor", "Phosphor"],
  ["paper", "Paper"],
];

export const FALLBACK_BACKGROUND = "#000000";

export interface Swatch {
  role: string;
  label: string;
  /** `#rrggbb`. */
  hex: string;
}

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i;

const byte = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

/** `#rgb`, `#rrggbb` or `rgb()/rgba()` -> lower-case `#rrggbb`; anything else undefined. */
export function toHex(value: string): string | undefined {
  const v = value.trim();
  const six = HEX6.exec(v);
  if (six) return `#${(six[1] ?? "").toLowerCase()}`;
  const three = HEX3.exec(v);
  if (three) return `#${[three[1], three[2], three[3]].map((c = "") => c + c).join("")}`.toLowerCase();
  const rgb = RGB.exec(v);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((c) => byte(Number(c))).join("")}`;
  return undefined;
}

/** The swatches whose role resolves to a colour on `root`. */
export function readSwatches(root: Element | undefined = typeof document === "undefined" ? undefined : document.documentElement): Swatch[] {
  if (root === undefined) return [];
  const style = root.ownerDocument.defaultView?.getComputedStyle(root);
  if (style === undefined) return [];
  const out: Swatch[] = [];
  for (const [role, label] of SWATCH_ROLES) {
    const hex = toHex(style.getPropertyValue(`--sr-${role}`));
    if (hex !== undefined) out.push({ role, label, hex });
  }
  return out;
}
