// Requirement 2.5: every text/surface role pair per theme meets WCAG AA.
// Body text roles (text, text-*) need 4.5:1 on every surface; that also covers large text.
// Signal and accent roles are for large or bold labels and glyphs (ON AIR, RECORDED, the bulb),
// so they need the large-text threshold of 3:1 on every surface.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTokens } from "./load.ts";
import { contrastRatio, parseHex, resolveTheme } from "./tokens.ts";

const AA_BODY = 4.5;
const AA_LARGE = 3;

const tokens = loadTokens(fileURLToPath(new URL("..", import.meta.url)));
const SURFACES = tokens.roles.filter((role) => /^surface-\d+$/.test(role));
const BODY_TEXT = tokens.roles.filter((role) => role === "text" || role.startsWith("text-"));
const LARGE_TEXT = tokens.roles.filter((role) => role.startsWith("signal-") || role === "accent");

const PAIRS: [fg: string, bg: string, min: number][] = SURFACES.flatMap((bg) => [
  ...BODY_TEXT.map((fg): [string, string, number] => [fg, bg, AA_BODY]),
  ...LARGE_TEXT.map((fg): [string, string, number] => [fg, bg, AA_LARGE]),
]);

it("finds surfaces and text roles to pair", () => {
  expect(SURFACES.length).toBeGreaterThan(0);
  expect(BODY_TEXT.length).toBeGreaterThan(0);
  expect(LARGE_TEXT.length).toBeGreaterThan(0);
});

describe.each([...tokens.themes])("theme %s", (theme, map) => {
  const { values } = resolveTheme(tokens.roles, tokens.scales, map, theme);

  it.each(PAIRS)("%s on %s >= %d:1", (fg, bg, min) => {
    const fgHex = values.get(fg) ?? "";
    const bgHex = values.get(bg) ?? "";
    const a = parseHex(fgHex);
    const b = parseHex(bgHex);
    expect(a, `${theme}: ${fg} is "${fgHex}", expected #rrggbb`).toBeDefined();
    expect(b, `${theme}: ${bg} is "${bgHex}", expected #rrggbb`).toBeDefined();
    if (!a || !b) return;
    const ratio = contrastRatio(a, b);
    expect(ratio, `${theme}: ${fg} ${fgHex} on ${bg} ${bgHex} is ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
  });
});
