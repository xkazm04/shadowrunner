// Requirement 2.1-2.4 against the committed token files.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_NAMES } from "./index.ts";
import { loadTokens } from "./load.ts";
import { resolveTheme, themeCss } from "./tokens.ts";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const tokens = loadTokens(PACKAGE_DIR);
const THEMES = [...tokens.themes.keys()];

/** design.md "Tokens": the initial vocabulary. Extend later, never rename. */
const INITIAL_ROLES = [
  ...["surface-0", "surface-1", "surface-2", "surface-3"],
  ...["text-strong", "text", "text-muted", "line"],
  ...["signal-onair", "signal-offline", "signal-warn", "signal-ok", "accent", "face-glow"],
  ...["haunt-fog", "haunt-flicker", "haunt-glow"],
  ...["font-display", "font-body", "font-mono", "radius-1"],
  ...["space-1", "space-2", "space-3", "space-4", "space-5", "space-6"],
  ...["size-text-sm", "size-text", "size-text-lg", "size-display"],
];

/** landing design.md "Tokens": roles the Harvest Floor adds (or rebinds) for the landing. */
const LANDING_ROLES = [
  ...["text-strong", "text", "text-muted", "signal-onair", "signal-warn", "signal-ok", "accent"],
  ...["phosphor", "phosphor-2", "phosphor-spill", "ember", "paper", "paper-ink", "paper-ink-signal"],
  ...["font-display", "font-body", "font-type"],
];

/** landing design.md: halloween values taken from the reference :root. */
const HALLOWEEN_LANDING: Record<string, string> = {
  "text-strong": "#efe6d0",
  text: "#c9bc9c",
  "text-muted": "#9c8f74",
  "signal-onair": "#ff4a33",
  "signal-warn": "#ff5b45",
  "signal-ok": "#8fe3b0",
  accent: "#f0a860",
  phosphor: "#e8f0ff",
  "phosphor-2": "#b9cdf2",
  "phosphor-spill": "rgb(150, 180, 255)",
  ember: "#ffb347",
  "paper-ink": "#1b130a",
  "paper-ink-signal": "#7e1407",
};

/** landing 1.2: the self-hosted @fontsource family each font role leads with, per theme. */
const FONT_FAMILIES: Record<string, Record<string, string>> = {
  halloween: { "font-display": "Barlow Semi Condensed", "font-body": "Inter", "font-type": "Courier Prime" },
  baseline: { "font-display": "Inter", "font-body": "Inter", "font-type": "Courier Prime" },
};

/** product.md: working text >= 14px equivalent (0.875rem at the 16px root). */
const MIN_TEXT_REM = 0.875;

function resolved(theme: string): ReadonlyMap<string, string> {
  const map = tokens.themes.get(theme);
  if (!map) throw new Error(`no theme ${theme}`);
  return resolveTheme(tokens.roles, tokens.scales, map, theme).values;
}

describe("token files", () => {
  it("ship exactly the themes in THEME_NAMES", () => {
    expect(THEMES).toEqual([...THEME_NAMES].sort());
  });

  it("keep the initial role vocabulary from design.md", () => {
    const missing = INITIAL_ROLES.filter((role) => !tokens.roles.includes(role));
    expect(missing, `roles.json lost: ${missing.join(", ")}`).toEqual([]);
  });

  it("carry the landing roles", () => {
    const missing = LANDING_ROLES.filter((role) => !tokens.roles.includes(role));
    expect(missing, `roles.json lacks: ${missing.join(", ")}`).toEqual([]);
  });

  it("bind halloween to the reference values", () => {
    const values = resolved("halloween");
    for (const [role, value] of Object.entries(HALLOWEEN_LANDING)) expect(values.get(role), role).toBe(value);
  });

  it("hold the raw ramps in scales/*.json", () => {
    const files = readdirSync(new URL("../scales", import.meta.url)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
  });
});

describe.each(THEMES)("theme %s", (theme) => {
  it("binds every role in roles.json to a scale value", () => {
    const map = tokens.themes.get(theme) ?? {};
    // Each problem names the theme and the role, e.g. `halloween: role "surface-2" is unbound`.
    expect(resolveTheme(tokens.roles, tokens.scales, map, theme).problems).toEqual([]);
  });

  it("emits a [data-theme] block declaring every role", () => {
    const css = themeCss(theme, resolved(theme));
    expect(css).toContain(`[data-theme="${theme}"] {`);
    const missing = tokens.roles.filter((role) => !css.includes(`  --sr-${role}: `));
    expect(missing).toEqual([]);
  });

  it("leads each font role with its self-hosted family", () => {
    const values = resolved(theme);
    const families = FONT_FAMILIES[theme];
    expect(families, `no font expectation for ${theme}`).toBeDefined();
    for (const [role, family] of Object.entries(families ?? {})) {
      expect(values.get(role), `${theme}: ${role}`).toMatch(new RegExp(`^"${family}",`));
    }
  });

  it(`keeps every text size at or above ${MIN_TEXT_REM}rem`, () => {
    const values = resolved(theme);
    const sizes = tokens.roles.filter((role) => role.startsWith("size-"));
    expect(sizes.length).toBeGreaterThan(0);
    for (const role of sizes) {
      const value = values.get(role) ?? "";
      const rem = /^(\d*\.?\d+)rem$/.exec(value)?.[1];
      expect(rem, `${theme}: ${role} is "${value}", expected <n>rem`).toBeDefined();
      expect(Number(rem), `${theme}: ${role} is ${value}`).toBeGreaterThanOrEqual(MIN_TEXT_REM);
    }
  });
});

describe("haunt axis", () => {
  const HAUNT = ["haunt-fog", "haunt-flicker", "haunt-glow"];

  it("baseline sets every haunt-* role to zero", () => {
    const values = resolved("baseline");
    const haunts = tokens.roles.filter((role) => role.startsWith("haunt-"));
    expect(haunts).toEqual(expect.arrayContaining(HAUNT));
    for (const role of haunts) {
      const value = values.get(role);
      expect(value !== undefined && /^0(?:\.0+)?$/.test(value), `baseline: ${role} is "${value}", expected 0`).toBe(true);
    }
  });
});
