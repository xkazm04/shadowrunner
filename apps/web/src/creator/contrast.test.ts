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
    // Anatomy Under Glass and the rite (costume 3): inks over the dark glass, the cards and keys.
    // A label over the face assumes the worst face behind it (white).
    ["callout label on surface-0 86% over a white face", r("text-strong"), mix(s0, [255, 255, 255], 0.86)],
    ["callout lamp name on surface-0 86% over a white face", r("text"), mix(s0, [255, 255, 255], 0.86)],
    ["ring label (face-glow) on surface-0 88% over a white face", glow, mix(s0, [255, 255, 255], 0.88)],
    ["found-box tag (face-glow) on surface-0 90% over a white portrait", glow, mix(s0, [255, 255, 255], 0.9)],
    ["rail layer name on surface-1", r("text-strong"), r("surface-1")],
    ["rail z and kind word on surface-1", r("text-muted"), r("surface-1")],
    ["card title on surface-1", r("text"), r("surface-1")],
    ["key label on surface-2", r("text-strong"), r("surface-2")],
    ["pressed key / emotion on face-glow", ink, glow],
    ["emotion label on surface-1", r("text"), r("surface-1")],
    ["voice note on surface-0", r("text"), s0],
    ["speak and next keys (face-glow) on surface-1", glow, r("surface-1")],
    ["Put on air and Forge it on signal-onair 62% over surface-0", r("text-strong"), mix(onair, s0, 0.62)],
    ["Forge new slot (ember) on accent 16% over surface-0", r("ember"), mix(r("accent"), s0, 0.16)],
    ["refusal ink (phosphor) on phosphor-2 7% over surface-0", r("phosphor"), mix(r("phosphor-2"), s0, 0.07)],
    ["refusal code line (phosphor-2) on phosphor-2 7% over surface-0", r("phosphor-2"), mix(r("phosphor-2"), s0, 0.07)],
    ["mark state NOW (signal-warn) on surface-1", r("signal-warn"), r("surface-1")],
    ["mark state DONE (ember) on surface-1", r("ember"), r("surface-1")],
    ["pressed seal numeral on ember 85% over surface-0", ink, mix(r("ember"), s0, 0.85)],
    ["tape step on its fill (accent 26% over surface-1)", r("text-strong"), mix(r("accent"), r("surface-1"), 0.26)],
    ["tape hold on surface-1", r("text-muted"), r("surface-1")],
    ["cut slot kind word (ember) on accent 7% over surface-1", r("ember"), mix(r("accent"), r("surface-1"), 0.07)],
    ["status and wait text on surface-0", r("text"), s0],
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
