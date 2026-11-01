// The stage's fills against the role tokens (voice-and-air requirements 4.2, 4.6): in both themes,
// the lit ON AIR lightbox is the brightest fill on the stage, and captions are text-strong on a
// dark plate at 14 px or more with AA contrast. Reads the stage's CSS Modules as text and the
// theme sources (scales/*.json, themes/*.json); resolves `var(--sr-*)` and
// `color-mix(in srgb, ...)` the way the browser does, compositing transparency over surface-0.
import { describe, expect, it } from "vitest";
import colorScale from "../../../../packages/theme/scales/color.json";
import hauntScale from "../../../../packages/theme/scales/haunt.json";
import spaceScale from "../../../../packages/theme/scales/space.json";
import typeScale from "../../../../packages/theme/scales/type.json";
import baseline from "../../../../packages/theme/themes/baseline.json";
import halloween from "../../../../packages/theme/themes/halloween.json";

// Vitest does not process CSS (a `?raw` import of it is empty) and the app's types have no Node,
// so node:fs is loaded by a computed specifier and typed locally (as in landing/ChatStrip.test).
interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
const NODE_FS = ["node", "fs"].join(":");
const fs: Fs = await import(/* @vite-ignore */ NODE_FS);
const css = (file: string) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

const THEMES: Record<string, Record<string, string>> = { baseline, halloween };

type Rgb = [number, number, number];

/** Role -> raw value for one theme, from the token sources. */
function themeValues(name: string): Map<string, string> {
  const scales: Record<string, Record<string, string>> = { ...colorScale, ...typeScale, ...spaceScale, ...hauntScale };
  const values = new Map<string, string>();
  for (const [role, ref] of Object.entries(THEMES[name] ?? {})) {
    const [ramp, step] = ref.split(".");
    const value = scales[ramp ?? ""]?.[step ?? ""];
    if (value !== undefined) values.set(role, value);
  }
  return values;
}

function hex(value: string): Rgb | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Every colour a fill declaration paints, as sRGB over the stage's surface-0. */
function fillColours(value: string, theme: Map<string, string>): Rgb[] {
  const base = hex(theme.get("surface-0") ?? "") ?? [0, 0, 0];
  const token = (name: string): Rgb | "transparent" | undefined => (name === "transparent" ? "transparent" : hex(theme.get(name) ?? ""));
  const out: Rgb[] = [];
  const mixes = /color-mix\(in srgb,\s*var\(--sr-([a-z0-9-]+)\)\s*(\d+)%,\s*(?:var\(--sr-([a-z0-9-]+)\)|(transparent))\s*\)/g;
  for (const m of value.matchAll(mixes)) {
    const a = token(m[1] ?? "");
    const b = token(m[3] ?? m[4] ?? "");
    if (a === undefined || a === "transparent" || b === undefined) continue;
    const p = Number(m[2]) / 100;
    const other = b === "transparent" ? base : b;
    out.push([0, 1, 2].map((i) => p * (a[i] ?? 0) + (1 - p) * (other[i] ?? 0)) as Rgb);
  }
  const bare = value.replace(mixes, "");
  for (const m of bare.matchAll(/var\(--sr-([a-z0-9-]+)\)/g)) {
    const c = token(m[1] ?? "");
    if (c !== undefined && c !== "transparent") out.push(c);
  }
  return out;
}

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

function rules(text: string): Rule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? "").trim(),
    decls: new Map(
      (m[2] ?? "")
        .split(";")
        .map((d) => d.split(/:(.*)/s).map((s) => s.trim()))
        .filter((d): d is [string, string] => d.length >= 2 && d[0] !== "" && d[1] !== undefined)
        .map(([k, v]) => [k, v] as [string, string]),
    ),
  }));
}

const STAGE_CSS = [css("./air.module.css"), css("./Chat.module.css")].flatMap((text) => rules(text));
const FILL_PROPS = ["background-color", "background-image", "background"];
/** Rules that are not on screen while on air (the dark lamp, the dead line). */
const OFF_AIR = /data-lit="off"|dead_line/;

function brightestFill(rule: Rule, theme: Map<string, string>): number {
  const lums = FILL_PROPS.flatMap((p) => {
    const v = rule.decls.get(p);
    return v === undefined ? [] : fillColours(v, theme).map(luminance);
  });
  return Math.max(0, ...lums);
}

describe.each(["halloween", "baseline"])("the stage in the %s theme", (name) => {
  const theme = themeValues(name);

  it("lights the ON AIR lightbox as the brightest fill on the stage", () => {
    const lit = STAGE_CSS.filter((r) => /\.lamp\[data-lit="on"\]/.test(r.selector));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit[0]?.decls.get("background-color")).toBe("var(--sr-signal-onair)");
    const lamp = Math.max(...lit.map((r) => brightestFill(r, theme)));
    const others = STAGE_CSS.filter((r) => !lit.includes(r) && !OFF_AIR.test(r.selector));
    expect(others.length).toBeGreaterThan(20);
    for (const rule of others) expect(brightestFill(rule, theme), rule.selector).toBeLessThan(lamp);
  });

  it("keeps the lit lamp's label readable (AA) on its glass", () => {
    const lit = STAGE_CSS.find((r) => /\.lamp\[data-lit="on"\]/.test(r.selector));
    const fg = hex(theme.get(/var\(--sr-([a-z0-9-]+)\)/.exec(lit?.decls.get("color") ?? "")?.[1] ?? "") ?? "");
    const bg = hex(theme.get("signal-onair") ?? "");
    expect(fg && bg && contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("sets captions in text-strong at 14 px or more, AA on their plate", () => {
    const line = STAGE_CSS.filter((r) => r.selector.split(",").some((s) => s.trim() === ".line"));
    const colour = line.map((r) => r.decls.get("color")).find((c) => c !== undefined);
    expect(colour).toBe("var(--sr-text-strong)");
    for (const rule of line) {
      const size = rule.decls.get("font-size");
      if (size === undefined) continue;
      const role = /var\(--sr-([a-z0-9-]+)\)/.exec(size)?.[1] ?? "";
      const value = parseFloat(theme.get(role) ?? "0");
      expect(value * 16, `${rule.selector} ${size}`).toBeGreaterThanOrEqual(14);
    }
    const plate = line.flatMap((r) => fillColours(r.decls.get("background-image") ?? "", theme));
    const text = hex(theme.get("text-strong") ?? "");
    expect(plate.length).toBeGreaterThan(0);
    for (const bg of plate) expect(text && contrast(text, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
