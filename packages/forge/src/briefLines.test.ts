// C4, a forged co-host goes on air as itself: the brief's optional `example_lines` (at most 3 short
// in-character lines). Recorded cast briefs carry none and still validate; a brief with lines
// round-trips through parseBriefJson; an over-long line or a fourth line is refused with a named rule.
import fc from "fast-check";
import b_auntie_asp from "../../../assets/characters/cast/auntie-asp/brief.json";
import b_lot_ninety from "../../../assets/characters/cast/lot-ninety/brief.json";
import b_reveille from "../../../assets/characters/cast/reveille/brief.json";
import b_saint_cardia from "../../../assets/characters/cast/saint-cardia/brief.json";
import b_sir_vacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import b_the_redactor from "../../../assets/characters/cast/the-redactor/brief.json";
import b_the_tallyman from "../../../assets/characters/cast/the-tallyman/brief.json";
import b_vicar_of_the_lure from "../../../assets/characters/cast/vicar-of-the-lure/brief.json";
import { describe, expect, it } from "vitest";
import { BRIEF_LIMITS, BRIEF_MAX_EXAMPLE_LINES, BRIEF_PROMPT, BRIEF_SCHEMA, briefFromRecorded, parseBrief } from "./brief.js";
import { parseBriefJson } from "./validate.js";
import type { CharacterBrief } from "./wire.js";

const CAST = [b_auntie_asp, b_lot_ninety, b_reveille, b_saint_cardia, b_sir_vacant, b_the_redactor, b_the_tallyman, b_vicar_of_the_lure];

const BRIEF: CharacterBrief = {
  name: "Brine",
  one_line_request: "an iron diving helmet that hums sea shanties",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties between lines and counts the fathoms of chat.",
  accent_hex: "#38c8ff",
  silhouette: "A round iron helmet with a hose.",
  parts: [
    { name: "helmet", role: "head", what: "iron helmet" },
    { name: "grille", role: "jaw", what: "face grille" },
    { name: "eye_l", role: "eye_l", what: "left porthole eye" },
    { name: "eye_r", role: "eye_r", what: "right porthole eye" },
    { name: "hose", role: "float", what: "curling air hose", motion: "drifts", follow: "helmet" },
    { name: "suit", role: "torso", what: "canvas diving suit" },
  ],
  style: { name: "Low-poly 3D", why: "Planes cut cleanly." },
  portrait_prompt: "Low-poly planes. An iron diving helmet with two porthole eyes and a curling hose.",
};

const LINES = ["Forty fathoms of chat and not one pearl.", "Hold your breath, the next song is long.", "Bubbles mean I am laughing."];

describe("brief example_lines", () => {
  it("the eight recorded cast briefs still validate without lines", () => {
    for (const raw of CAST) {
      const r = briefFromRecorded(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.example_lines).toBeUndefined();
    }
  });

  it("a brief with example_lines round-trips through parseBriefJson", () => {
    const brief = { ...BRIEF, example_lines: LINES };
    expect(parseBriefJson(JSON.stringify(brief))).toEqual({ ok: true, value: brief });
  });

  it("lines are trimmed and an empty list is omitted (optional fields are omitted, never empty)", () => {
    expect(parseBrief({ ...BRIEF, example_lines: ["  Bubbles.  "] })).toEqual({ ok: true, value: { ...BRIEF, example_lines: ["Bubbles."] } });
    expect(parseBrief({ ...BRIEF, example_lines: [] })).toEqual({ ok: true, value: BRIEF });
  });

  it("refuses an over-long line, a fourth line, an empty line and a non-list, each with a named rule", () => {
    const over = parseBrief({ ...BRIEF, example_lines: ["ok", "x".repeat(BRIEF_LIMITS.example_line + 1)] });
    expect(over).toEqual({ ok: false, errors: [{ path: "$.example_lines[1]", message: "must be at most 160 characters" }] });
    const four = parseBrief({ ...BRIEF, example_lines: [...LINES, "a fourth"] });
    expect(four).toEqual({ ok: false, errors: [{ path: "$.example_lines", message: `must list at most ${BRIEF_MAX_EXAMPLE_LINES} lines` }] });
    expect(parseBrief({ ...BRIEF, example_lines: ["  "] })).toEqual({ ok: false, errors: [{ path: "$.example_lines[0]", message: "must not be empty" }] });
    expect(parseBrief({ ...BRIEF, example_lines: "a line" })).toEqual({ ok: false, errors: [{ path: "$.example_lines", message: "must be an array of lines" }] });
  });

  it("the prompt asks for three in-character lines; the schema offers the field without requiring it", () => {
    expect(BRIEF_PROMPT("a lich")).toContain("example_lines gives three short lines the character would say on air");
    expect(BRIEF_SCHEMA.properties.example_lines.type).toBe("array");
    expect((BRIEF_SCHEMA.required as readonly string[]).includes("example_lines")).toBe(false);
  });

  it("fast-check: any 0..3 non-empty lines within the limit are accepted as given (an empty list omitted)", () => {
    const line = fc.string({ minLength: 1, maxLength: BRIEF_LIMITS.example_line }).filter((s) => s.trim() === s && s !== "");
    fc.assert(
      fc.property(fc.array(line, { maxLength: BRIEF_MAX_EXAMPLE_LINES }), (lines) => {
        const r = parseBrief({ ...BRIEF, example_lines: lines });
        expect(r).toEqual({ ok: true, value: lines.length === 0 ? BRIEF : { ...BRIEF, example_lines: lines } });
      }),
    );
  });

  it("fast-check: any line past the limit, at any position, is refused at its own path", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), fc.integer({ min: BRIEF_LIMITS.example_line + 1, max: 400 }), (at, n) => {
        const lines = ["a", "b", "c"].map((l, i) => (i === at ? "y".repeat(n) : l));
        const r = parseBrief({ ...BRIEF, example_lines: lines });
        return !r.ok && r.errors.some((e) => e.path === `$.example_lines[${at}]`);
      }),
    );
  });
});
