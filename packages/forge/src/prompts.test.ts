// forge-pipeline task 2.1: the prompts are the exact strings from design.md "Prompts (exact)".
// The expected strings are copied here from design.md (line breaks joined with one space), so
// an edit to prompts.ts that drifts from the design fails this test.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  HOUSE_STYLE,
  LIKENESS_PROMPT,
  MAX_CHARACTER_TEXT,
  PARTS_PROMPT,
  fillPrompt,
  portraitPrompt,
  restylePrompt,
} from "./prompts.js";

const DESIGN_HOUSE_STYLE =
  "Original character portrait, head and shoulders bust, facing the camera, centred, symmetrical framing, theatrical horror, painterly realism, dramatic rim light, the face clearly separated from the body, the jaw and eyes clearly visible, near-black (#050505) empty background, no text, no logos, no frame, not a real person, no gore, 1:1.";

describe("prompts (design.md, exact)", () => {
  it("HOUSE_STYLE", () => {
    expect(HOUSE_STYLE).toBe(DESIGN_HOUSE_STYLE);
  });

  it("restylePrompt", () => {
    expect(restylePrompt()).toBe(
      `Redraw this image as: ${DESIGN_HOUSE_STYLE} Keep the character's defining features, costume and colours.`,
    );
  });

  it("LIKENESS_PROMPT", () => {
    expect(LIKENESS_PROMPT).toBe(
      'Classify this image. Return {"real_person": boolean, "unsafe": boolean, "reason": string}. real_person is true if it shows a photograph or realistic depiction of an identifiable real human face. unsafe is true for sexual content, gore or hate symbols.',
    );
  });

  it("PARTS_PROMPT", () => {
    expect(PARTS_PROMPT).toBe(
      "This is a character portrait to be cut into animation layers. For each visible part among: head (skull/face, excluding crown, hair, hat and jaw), jaw (lower jaw that moves when speaking), eye_l (character's left eye), eye_r, monocle, crown (all crown spikes together), hat, hair, accessory (one other worn object on the head), torso (shoulders/robe), return a tight polygon outline. Return JSON: [{\"name\": string, \"box_2d\": [ymin,xmin,ymax,xmax], \"poly\": [[y,x],...]}] with coordinates normalized to 0-1000, 8-40 points per polygon, clockwise. Omit parts that are not visible.",
    );
  });

  it("fillPrompt lists the lifted parts", () => {
    expect(fillPrompt(["jaw", "eye_l", "eye_r"])).toBe(
      "Same image, same framing and lighting. Remove the jaw, eye_l, eye_r and paint the plausible surface that would be behind them. Change nothing else.",
    );
  });

  it("portraitPrompt inserts the text after the house style", () => {
    expect(portraitPrompt("a lich in a moth-eaten robe")).toBe(
      `${DESIGN_HOUSE_STYLE} The character: a lich in a moth-eaten robe`,
    );
  });

  it("property: portraitPrompt passes at most 400 characters of the user's text", () => {
    expect(MAX_CHARACTER_TEXT).toBe(400);
    const prefix = `${DESIGN_HOUSE_STYLE} The character: `;
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 900, size: "max" }), fc.string({ minLength: 399, maxLength: 402 })), (text) => {
        const prompt = portraitPrompt(text);
        expect(prompt.startsWith(prefix)).toBe(true);
        const inserted = prompt.slice(prefix.length);
        expect(inserted).toBe(text.slice(0, 400));
        expect(inserted.length).toBeLessThanOrEqual(400);
      }),
    );
  });
});
