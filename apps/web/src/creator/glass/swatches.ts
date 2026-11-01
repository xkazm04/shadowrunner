// The swatch rings (costume 3.1, after `r1/creator-b.html` `SW` and `NAMES`): eight lamps per light,
// each with a name the label shows. The colours are look data (they are written to Look.palette and
// painted inline on the ring), not page styling, so they live here and not in the theme.
import type { Palette } from "@sr/rig";

export const LIGHT_LABELS: Readonly<Record<keyof Palette, string>> = {
  eye: "Eye light",
  glow: "Glow",
  rim: "Rim light",
  mouth: "Mouth light",
};

export const SWATCHES: Readonly<Record<keyof Palette, readonly string[]>> = {
  eye: ["#3fd6c4", "#5fc89e", "#7ad35a", "#e0453a", "#9a5cf0", "#e6b84a", "#f2efe8", "#3f9fe0"],
  glow: ["#ff7a1a", "#e08a2c", "#d93a3a", "#3f9fe0", "#9a5cf0", "#5fc86a", "#f2efe8", "#e6d24a"],
  rim: ["#e8902c", "#e9c9a0", "#7f8fe6", "#e0608a", "#6fd0a8", "#f2efe8", "#c8392b", "#9a5cf0"],
  mouth: ["#33d9c7", "#ff9a3a", "#e0453a", "#9a5cf0", "#e6d24a", "#f2efe8", "#5fc86a", "#ffb347"],
};

const NAMES: Readonly<Record<string, string>> = {
  "#3fd6c4": "verdigris", "#5fc89e": "ledger", "#7ad35a": "bog", "#e0453a": "ember", "#9a5cf0": "violet",
  "#e6b84a": "tallow", "#f2efe8": "bone", "#3f9fe0": "brine", "#ff7a1a": "forge", "#e08a2c": "amber",
  "#d93a3a": "cinder", "#5fc86a": "moss", "#e6d24a": "sulphur", "#e8902c": "lamp", "#e9c9a0": "candle",
  "#7f8fe6": "moon", "#e0608a": "rose", "#6fd0a8": "wisp", "#c8392b": "signal", "#33d9c7": "verdigris",
  "#ff9a3a": "wick", "#ffb347": "ember amber", "#fec654": "candle", "#d8a030": "tallow",
};

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** A lamp's name; a colour off the rings (a rig's own) takes the name of the nearest lamp. */
export function swatchName(hex: string): string {
  const c = hex.toLowerCase();
  const own = NAMES[c];
  if (own !== undefined || !/^#[0-9a-f]{6}$/.test(c)) return own ?? c;
  const [r, g, b] = rgb(c);
  let best = c;
  let dist = Infinity;
  for (const [h, name] of Object.entries(NAMES)) {
    const [r2, g2, b2] = rgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < dist) [best, dist] = [name, d];
  }
  return best;
}

/** The ring for a light: its eight lamps, the current colour leading when it is not one of them. */
export function ringOf(key: keyof Palette, current: string): string[] {
  const own = SWATCHES[key];
  const c = current.toLowerCase();
  return own.includes(c) ? [...own] : [c, ...own.slice(0, own.length - 1)];
}
