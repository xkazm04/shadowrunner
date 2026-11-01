// Requirement 5.5: the creator's working text meets WCAG AA in both themes. The theme package
// checks bare role pairs; the creator also lays inks over mixes (parchment fields, bakelite keys,
// the red signal keys, unselected tabs, faded notes). This test resolves the roles from the theme
// sources (JSON imports) and computes each composite the way the CSS modules write it (color-mix in srgb and
// opacity both interpolate the gamma-encoded channels). Keep the MIX table in step with the CSS.
import { describe, expect, it } from "vitest";
import colorScale from "../../../../packages/theme/scales/color.json";
import baseline from "../../../../packages/theme/themes/baseline.json";
import halloween from "../../../../packages/theme/themes/halloween.json";

type Rgb = [number, number, number];

const THEMES: Readonly<Record<string, Readonly<Record<string, string>>>> = { baseline, halloween };
const colors: Readonly<Record<string, Readonly<Record<string, string>>>> = colorScale;

function role(theme: string, name: string): Rgb {
  const ref = THEMES[theme]?.[name];
  if (typeof ref !== "string") throw new Error(`${theme}: no role ${name}`);
  const [ramp, step] = ref.split(".");
  const hex = colors[ramp ?? ""]?.[step ?? ""];
  if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${theme}: ${name} -> ${ref} is not a hex colour`);
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** color-mix(in srgb, a p, b) and `a` at opacity p over b. */
const mix = (a: Rgb, b: Rgb, p: number): Rgb => [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2] * p + b[2] * (1 - p)];

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [what, ink, ground] per theme, as the creator's CSS composes them. All are body text: 4.5:1. */
function pairs(theme: string): [string, Rgb, Rgb][] {
  const r = (n: string) => role(theme, n);
  const paper = r("paper");
  const ink = r("paper-ink");
  const glow = r("face-glow");
  const s0 = r("surface-0");
  const onair = r("signal-onair");
  return [
    ["sheet ink on parchment", ink, paper],
    ["faded note (0.86) on parchment", mix(ink, paper, 0.86), paper],
    ["field ink on face-glow 60% over parchment", ink, mix(glow, paper, 0.6)],
    ["chip ink on face-glow 45% over parchment", ink, mix(glow, paper, 0.45)],
    ["unselected tab ink on parchment 78% over surface-0", ink, mix(paper, s0, 0.78)],
    ["alarm ink on parchment", r("paper-ink-signal"), paper],
    ["key label on the lightest bakelite (surface-3)", r("text-strong"), r("surface-3")],
    ["signal key label on its lightest red", r("text-strong"), mix(onair, s0, 0.62)],
    ["pressed key label on its lightest red", r("text-strong"), mix(onair, s0, 0.62)],
    ["library card text on surface-1", r("text"), r("surface-1")],
    ["caption text on surface-0", r("text"), s0],
    ["forging card on surface-1 92% over surface-0", r("text-strong"), mix(r("surface-1"), s0, 0.92)],
    ["subtitle on surface-0 82% over a white face", r("text-strong"), mix(s0, [255, 255, 255], 0.82)],
    // Gallery cards and library tiles (creator task 9): text on a dark band over a portrait.
    ["gallery name on its band (surface-0 88% over a white portrait)", r("text-strong"), mix(s0, [255, 255, 255], 0.88)],
    ["library tile name on its band (surface-0 88% over a white still)", r("text-strong"), mix(s0, [255, 255, 255], 0.88)],
  ];
}

describe.each(["halloween", "baseline"])("creator contrast, %s", (theme) => {
  it.each(pairs(theme))("%s >= 4.5:1", (_what, ink, ground) => {
    expect(ratio(ink, ground)).toBeGreaterThanOrEqual(4.5);
  });
});
