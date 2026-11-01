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
