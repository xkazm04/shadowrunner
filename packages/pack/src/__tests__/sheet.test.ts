// C4: the character sheet a forged co-host goes on air with. readSheet (fast-check: every sheet within
// the limits reads back as given; any field past its limit drops the whole sheet), and the pack's
// optional `sheet`: written when given, read back, omitted when absent, dropped (not refused) when bad.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readPack, readSheet, SHEET_LIMITS, writePack, type CharacterSheet } from "../index.js";
import { craft, packInput, readJson, writeJson } from "./fixtures.js";

const SHEET: CharacterSheet = { archetype: "Drowned diver", hook: "Hums shanties between lines.", lines: ["Forty fathoms of chat.", "Bubbles mean I laugh."] };

const clean = (max: number) => fc.string({ minLength: 1, maxLength: max }).filter((s) => s.trim() === s && s !== "");
const arbSheet = fc.record({
  archetype: clean(SHEET_LIMITS.archetype),
  hook: clean(SHEET_LIMITS.hook),
  lines: fc.array(clean(SHEET_LIMITS.line), { maxLength: SHEET_LIMITS.lines }),
});

describe("readSheet", () => {
  it("fast-check: every sheet within the limits reads back as given", () => {
    fc.assert(
      fc.property(arbSheet, (s) => {
        expect(readSheet(s)).toEqual(s);
      }),
    );
  });

  it("fast-check: one field past its limit, a fourth line or an empty field drops the sheet", () => {
    const faults: ((s: CharacterSheet) => unknown)[] = [
      (s) => ({ ...s, archetype: "a".repeat(SHEET_LIMITS.archetype + 1) }),
      (s) => ({ ...s, hook: "h".repeat(SHEET_LIMITS.hook + 1) }),
      (s) => ({ ...s, lines: [...s.lines.slice(0, 2), "l".repeat(SHEET_LIMITS.line + 1)] }),
      (s) => ({ ...s, lines: ["a", "b", "c", "d"] }),
      (s) => ({ ...s, hook: "  " }),
      (s) => ({ ...s, lines: "one line" }),
    ];
    fc.assert(fc.property(arbSheet, fc.integer({ min: 0, max: faults.length - 1 }), (s, i) => readSheet(faults[i]?.(s)) === undefined));
  });

  it("trims, and refuses what is not a sheet", () => {
    expect(readSheet({ archetype: " A ", hook: " H ", lines: [" L "] })).toEqual({ archetype: "A", hook: "H", lines: ["L"] });
    fc.assert(fc.property(fc.anything(), (v) => readSheet(v) === undefined || typeof v === "object"));
    expect(readSheet(null)).toBeUndefined();
    expect(readSheet([SHEET])).toBeUndefined();
  });
});

describe("pack sheet", () => {
  it("a sheet goes into pack.json and comes back on read", async () => {
    const bytes = await writePack(packInput({ sheet: SHEET }));
    const result = await readPack(bytes);
    expect(result.ok && result.pack.sheet).toEqual(SHEET);
    expect(result.ok && result.pack.manifest.sheet).toEqual(SHEET);
  });

  it("without a sheet the manifest has no sheet key (existing packs read as before)", async () => {
    const bytes = await writePack(packInput());
    const result = await readPack(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("sheet" in result.pack).toBe(false);
      expect("sheet" in result.pack.manifest).toBe(false);
    }
  });

  it("a sheet that does not read is dropped and the face still loads", async () => {
    const bytes = craft(await writePack(packInput({ sheet: SHEET })), (entries) => {
      const manifest = readJson(entries["pack.json"]);
      manifest.sheet = { archetype: "x", hook: "y", lines: ["z".repeat(500)] };
      entries["pack.json"] = writeJson(manifest);
    });
    const result = await readPack(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.sheet).toBeUndefined();
  });
});
