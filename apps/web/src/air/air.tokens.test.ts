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

const STAGE_FILES = ["./air.module.css", "./Catacomb.module.css", "./OnAirLamp.module.css", "./Captions.module.css", "./Chat.module.css", "./Grain.module.css"];
const STAGE_CSS = STAGE_FILES.map(css).flatMap((text) => rules(text));
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

  it("sets captions in text-strong at 14 px or more, AA on their bar", () => {
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
    const plate = STAGE_CSS.filter((r) => r.selector === ".bar").flatMap((r) => fillColours(r.decls.get("background-image") ?? "", theme));
    const text = hex(theme.get("text-strong") ?? "");
    expect(plate.length).toBeGreaterThan(0);
    for (const bg of plate) expect(text && contrast(text, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("haunt bound to status in the stage CSS", () => {
  const air = rules(css("./air.module.css"));
  const catacomb = rules(css("./Catacomb.module.css"));
  const moving = (r: Rule) => [...r.decls].some(([k, v]) => (k === "animation" || k === "transition") && v !== "none");

  it.each(STAGE_FILES)("gives every animation and transition in %s a reduced-motion twin that holds still", (file) => {
    const sheet = rules(css(file));
    const twins = sheet.filter((r) => r.selector.includes(':global([data-motion="reduced"])'));
    const still = (r: Rule) => r.decls.get("animation") === "none" && r.decls.get("transition") === "none";
    const covered = new Set(
      twins.filter(still).flatMap((r) => r.selector.split(",").map((s) => s.replace(':global([data-motion="reduced"])', "").trim())),
    );
    const animated = sheet.filter((r) => moving(r) && !r.selector.includes("data-motion"));
    for (const rule of animated) for (const sel of rule.selector.split(",")) expect(covered.has(sel.trim()), sel).toBe(true);
  });

  it("drives the dead line from data-state: haunt glow to zero, the face dimmed, the corridor cold", () => {
    const dead = air.find((r) => r.selector === '.stage[data-state="dead_line"]');
    expect(dead?.decls.get("--sr-haunt-glow")).toBe("0");
    // the face is dimmed by the renderer to its eyes (AirPage `dim`), not by a whole-face brightness filter
    expect(air.find((r) => r.selector === '.stage[data-state="dead_line"] .face')?.decls.get("filter")).not.toMatch(/brightness/);
    const deadSel = (part: string) => catacomb.filter((r) => r.selector.split(",").some((s) => s.trim() === `:global([data-page="air"][data-state="dead_line"]) ${part}`) && !r.selector.includes("data-motion"));
    // the candles burn down to embers, their halos and reflections go out, the tunnel light too
    expect(deadSel(".tip")[0]?.decls.get("transform")).toMatch(/scaleY\(0\.\d+\)/);
    expect(deadSel(".halo")[0]?.decls.get("opacity")).toBe("0");
    expect(deadSel(".refl")[0]?.decls.get("opacity")).toBe("0");
    expect(deadSel(".bloom")[0]?.decls.get("opacity")).toBe("0");
    expect(Number(deadSel(".tunnel")[0]?.decls.get("opacity"))).toBeLessThan(0.1);
    // the bulb tries to strike once per health poll (5 s)
    expect(deadSel(".glass")[0]?.decls.get("animation")).toMatch(/^strike 5s /);
  });

  it("binds the candles to their levels and stills them when the theme does not haunt", () => {
    expect(catacomb.find((r) => r.selector === ".tip")?.decls.get("transform")).toContain("var(--flame)");
    expect(catacomb.find((r) => r.selector === ".halo")?.decls.get("opacity")).toBe("var(--glow)");
    expect(catacomb.find((r) => r.selector === ".refl")?.decls.get("opacity")).toContain("var(--refl)");
    expect(catacomb.find((r) => r.selector === ':global([data-haunt="off"]) .tip')?.decls.get("animation")).toBe("none");
  });

  it("binds the film grain to the theme's fog, moves it by transform only, and removes it when the theme does not haunt", () => {
    const grain = rules(css("./Grain.module.css"));
    const base = grain.find((r) => r.selector === ".grain");
    expect(base?.decls.get("opacity")).toMatch(/^calc\(var\(--sr-haunt-fog\) \* 0\.\d+\)$/);
    expect(base?.decls.get("pointer-events")).toBe("none");
    expect(base?.decls.get("animation")).toMatch(/step-end/);
    // Every keyframe changes transform and nothing else (no repaint, only compositing).
    const frames = grain.filter((r) => /^\d+%$/.test(r.selector));
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect([...f.decls.keys()]).toEqual(["transform"]);
    expect(grain.find((r) => r.selector === ':global([data-haunt="off"]) .grain')?.decls.get("display")).toBe("none");
    for (const name of ["halloween", "baseline"]) {
      const fog = Number(themeValues(name).get("haunt-fog"));
      const strength = fog * Number(/\* (0\.\d+)/.exec(base?.decls.get("opacity") ?? "")?.[1]);
      // Visible but subtle where the theme haunts; none at all in the baseline theme.
      if (name === "baseline") expect(strength).toBe(0);
      else expect(strength > 0.03 && strength < 0.12, `${name} ${strength}`).toBe(true);
    }
  });

  it("binds every haunt token to zero in the baseline theme", () => {
    const baselineValues = themeValues("baseline");
    for (const role of ["haunt-fog", "haunt-flicker", "haunt-glow"]) expect(Number(baselineValues.get(role))).toBe(0);
  });
});
