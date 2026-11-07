// C4: the sheet's script (sheetShow.ts). fast-check: the show is never empty, plays only the sheet's
// lines (or its hook when it has none), is the same for the same input, validates as a show, and
// the scripted engine loops it; a recording is played only for exactly the line, in the voice.
import { parseShow, type ShowBank, type ShowScript } from "@sr/engine";
import type { CharacterSheet } from "@sr/pack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exactRecording, HOOK_LINE_CHARS, localScript, recordingUrl, scriptLines, sheetBible, sheetShow } from "./sheetShow";

const text = (max: number) => fc.string({ minLength: 1, maxLength: max }).filter((s) => s.trim() !== "");
const arbSheet: fc.Arbitrary<CharacterSheet> = fc.record({
  archetype: text(120),
  hook: text(400),
  lines: fc.array(text(160), { maxLength: 3 }),
});
const arbId = fc.stringMatching(/^[a-z0-9-]{1,24}$/);

describe("sheetShow (fast-check)", () => {
  it("is never empty, validates as a show, and plays only the sheet's lines", () => {
    fc.assert(
      fc.property(arbId, arbSheet, (id, sheet) => {
        const show = sheetShow(id, sheet);
        expect(show.beats.length).toBeGreaterThan(0);
        expect(parseShow(show)).toEqual(show);
        const lines = show.beats.map((b) => b.reply.line);
        if (sheet.lines.length > 0) expect(lines).toEqual(sheet.lines.map((l) => l.trim()));
        else expect(lines).toHaveLength(1);
        for (const line of lines) expect(line.length).toBeGreaterThan(0);
        if (sheet.lines.length === 0) expect(sheet.hook.trim().startsWith(lines[0] ?? "-")).toBe(true);
        expect(show.audience).toEqual([]);
        expect(show.beats.every((b) => b.wav === "" && b.replyTo === undefined)).toBe(true);
      }),
    );
  });

  it("is deterministic: the same id and sheet give the same show", () => {
    fc.assert(
      fc.property(arbId, arbSheet, (id, sheet) => {
        expect(sheetShow(id, sheet)).toEqual(sheetShow(id, { ...sheet, lines: [...sheet.lines] }));
      }),
    );
  });

  it("the local script loops it: beat n answers line n mod lines, never a line from elsewhere", () => {
    fc.assert(
      fc.property(arbId, arbSheet, fc.nat(1000), (id, sheet, beat) => {
        const show = sheetShow(id, sheet);
        const script = localScript(show, "crypt", { shows: [], recorded: new Set() });
        const persona = { characterId: id, name: "X", bible: "", voice: "crypt" as const };
        const reply = script.reply({ characterId: id, persona, chat: [], beat });
        expect(reply.line).toBe(show.beats[beat % show.beats.length]?.reply.line);
        expect(scriptLines(sheet)).toContain(reply.line);
      }),
    );
  });
});

describe("sheetShow pieces", () => {
  it("a sheet with no lines uses its hook, cut at a sentence to the line limit", () => {
    const hook = `${"A sentence that runs. ".repeat(10)}`;
    const [line] = scriptLines({ archetype: "A", hook, lines: [] });
    expect(line?.length).toBeLessThanOrEqual(HOOK_LINE_CHARS);
    expect(line?.endsWith(".")).toBe(true);
  });

  it("the bible carries the name, hook, archetype and lines", () => {
    const bible = sheetBible("Brine", { archetype: "Drowned diver", hook: "Hums.", lines: ["One.", "Two."] });
    expect(bible).toBe("# Brine\n\nHums.\n\nArchetype: Drowned diver\n\nOriginal fiction. Speak in this register:\n- One.\n- Two.");
  });

  it("plays a recording only for exactly the line, in a show of the same voice, when the WAV exists", () => {
    const show: ShowScript = {
      id: "malakor-night",
      characterId: "malakor",
      fictional: true,
      audience: [],
      beats: [
        { at: 0, reply: { line: "Kneel.", emotion: "smug" }, wav: "malakor-night/b00.wav" },
        { at: 1, reply: { line: "Unrecorded.", emotion: "smug" }, wav: "malakor-night/b01.wav" },
      ],
    };
    const bank: ShowBank = { shows: [show], recorded: new Set(["malakor-night/b00.wav"]) };
    expect(exactRecording(bank, " Kneel. ", "clerk")).toBe("/replay/shows/malakor-night/b00.wav");
    expect(exactRecording(bank, "Kneel.", "crypt")).toBeUndefined(); // Malakor's clips are in clerk
    expect(exactRecording(bank, "Unrecorded.", "clerk")).toBeUndefined();
    expect(exactRecording(bank, "Kneel, mortal.", "clerk")).toBeUndefined(); // never a stand-in phrase
    expect(recordingUrl("a b/c#.wav")).toBe("/replay/shows/a%20b/c%23.wav");
  });
});
