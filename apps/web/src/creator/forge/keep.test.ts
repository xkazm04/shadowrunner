// C4: a job drawn from an approved brief is kept under the brief's name with its character sheet.
import { defaultLook } from "@sr/rig";
import type { CharacterBrief } from "@sr/forge/wire";
import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "../library/libraryStore";
import { testRig } from "../testFixtures";
import { sheetOf, withBrief } from "./keep";

const BRIEF: CharacterBrief = {
  name: "Brine, of the Forty Fathoms",
  one_line_request: "an iron diving helmet that hums sea shanties",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties between lines and counts the fathoms of chat.",
  accent_hex: "#38c8ff",
  silhouette: "A round iron helmet with a hose.",
  parts: [],
  style: { name: "Low-poly 3D", why: "Planes cut cleanly." },
  portrait_prompt: "Low-poly planes.",
  example_lines: ["Forty fathoms of chat and not one pearl.", "Bubbles mean I am laughing."],
};

function record(): CharacterRecord {
  const rig = testRig("forge-123", "Forged");
  return { id: rig.id, rig, assets: {}, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-07T00:00:00.000Z" };
}

describe("keeping a briefed forge", () => {
  it("names the record as its brief and carries archetype, hook and example lines", () => {
    const kept = withBrief(record(), BRIEF);
    expect(kept.rig.name).toBe("Brine, of the Forty Fathoms");
    expect(kept.id).toBe("forge-123");
    expect(kept.sheet).toEqual({ archetype: "Drowned diver", hook: BRIEF.persona_hook, lines: BRIEF.example_lines });
  });

  it("a brief without example lines keeps a sheet with no lines", () => {
    const plain: CharacterBrief = { ...BRIEF };
    delete plain.example_lines;
    expect(sheetOf(plain)).toEqual({ archetype: "Drowned diver", hook: BRIEF.persona_hook, lines: [] });
  });
});
