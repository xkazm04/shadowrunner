import { describe, expect, it } from "vitest";
import { VOICE_IDS, VOICES } from "@sr/engine";

describe("VOICES", () => {
  it("covers exactly the design's voice ids", () => {
    expect([...VOICE_IDS]).toEqual(["crypt", "velvet", "rasp", "choir", "clerk"]);
    expect(Object.keys(VOICES).sort()).toEqual([...VOICE_IDS].sort());
  });

  it("maps each id to its own non-empty Gemini voice and label", () => {
    const gemini = VOICE_IDS.map((id) => VOICES[id].gemini);
    expect(new Set(gemini).size).toBe(VOICE_IDS.length);
    for (const id of VOICE_IDS) {
      expect(VOICES[id].gemini.trim()).not.toBe("");
      expect(VOICES[id].label.trim()).not.toBe("");
    }
  });
});
