// Requirement 2.5: every text/surface role pair per theme meets WCAG AA.
// Body text roles (text, text-*) need 4.5:1 on every surface; that also covers large text.
// Signal and accent roles are for large or bold labels and glyphs (ON AIR, RECORDED, the bulb),
// so they need the large-text threshold of 3:1 on every surface.
// landing 1.1 adds the chat inks on paper and phosphor text on the glass, both at 4.5:1.
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

// landing 1.1: the chat strip is 16px text on opaque paper, so its inks need 4.5:1, not 3:1.
const PAPER_PAIRS: [string, string, number][] = [
  ["paper-ink", "paper", AA_BODY],
  ["paper-ink-signal", "paper", AA_BODY],
];
// landing 1.1: phosphor text (lower third, hover caption, NO CARRIER) sits on the dark glass. The
// glass has no role of its own; its backing is a surface, so phosphor must clear 4.5:1 on all of them.
const PHOSPHOR_TEXT = ["phosphor", "phosphor-2"];
const GLASS_PAIRS = SURFACES.flatMap((bg) => PHOSPHOR_TEXT.map((fg): [string, string, number] => [fg, bg, AA_BODY]));
// costume 5.1: the root vault's alarm readings sit on the darkened plate, backed by surface-0 shade.
const VAULT_PAIRS = SURFACES.map((bg): [string, string, number] => ["vault-alarm", bg, AA_BODY]);

const PAIRS: [fg: string, bg: string, min: number][] = [
  ...SURFACES.flatMap((bg) => [
    ...BODY_TEXT.map((fg): [string, string, number] => [fg, bg, AA_BODY]),
    ...LARGE_TEXT.map((fg): [string, string, number] => [fg, bg, AA_LARGE]),
  ]),
  ...PAPER_PAIRS,
  ...GLASS_PAIRS,
  ...VAULT_PAIRS,
];

it("finds surfaces and text roles to pair", () => {
  expect(SURFACES.length).toBeGreaterThan(0);
  expect(BODY_TEXT.length).toBeGreaterThan(0);
  expect(LARGE_TEXT.length).toBeGreaterThan(0);
  for (const role of [...PHOSPHOR_TEXT, "paper", "paper-ink", "paper-ink-signal"]) expect(tokens.roles).toContain(role);
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
