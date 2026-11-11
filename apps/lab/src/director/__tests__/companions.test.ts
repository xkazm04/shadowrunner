// companion-lanes task 3: the lab's two companion scenarios (Iris, Bun) and the voice they speak in.
// A character outside the cast speaks in the voice its built pack carries (build-packs'
// COMPANION_VOICES), not the "crypt" fallback; the fixtures answer every chat line, walk through at
// least five emotions with gestures, and put lip-closing consonants in every line.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePack } from "@sr/pack";
import { defaultLook, type Rig } from "@sr/rig";
import { afterAll, describe, expect, it } from "vitest";
import { loadFixture } from "../arms/control/fixture.js";
import { voiceOf } from "../live.js";
import { SCENARIOS_DIR } from "../paths.js";
import { loadScenario } from "../scenario.js";

const dir = mkdtempSync(join(tmpdir(), "sr-lab-voice-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rig: Rig = {
  version: 1,
  id: "iris",
  name: "Iris",
  width: 8,
  height: 8,
  source: "replay",
  fictional: true,
  palette: { glow: "#000000", eye: "#ffffff", rim: "#000000", mouth: "#000000" },
  layers: [{ name: "head", z: 1, kind: "head", file: "head.png", bbox: [0, 0, 8, 8], anchor: [4, 8] }],
};

describe("voiceOf", () => {
  it("keeps the cast's voice, reads a companion's from its pack, and falls back to crypt", async () => {
    const stamp = "2026-11-11T00:00:00.000Z";
    const bytes = await writePack({ rig, look: defaultLook(rig), voice: "velvet", files: { "head.png": new Uint8Array([1]) }, licence: "all-rights-reserved", createdAt: stamp, exportedAt: stamp });
    writeFileSync(join(dir, "iris.srpack"), bytes);
    writeFileSync(join(dir, "broken.srpack"), "not a zip");
    expect(await voiceOf("iris", dir)).toBe("velvet");
    expect(await voiceOf("saint-cardia", dir)).toBe("choir");
    expect(await voiceOf("broken", dir)).toBe("crypt");
    expect(await voiceOf("nobody", dir)).toBe("crypt");
  });
});

describe("the companion scenarios", () => {
  for (const id of ["companion-iris", "companion-bun"]) {
    it(`${id}: 6-8 lines, every chat answered, five or more emotions, gestures, a lip closure in every line`, () => {
      const scenario = loadScenario(id);
      const fixture = loadFixture(join(SCENARIOS_DIR, `${id}.fixture.json`));
      expect(fixture.scenario).toBe(id);
      expect(scenario.chat.length).toBeGreaterThanOrEqual(6);
      expect(scenario.chat.length).toBeLessThanOrEqual(8);
      const replies = scenario.chat.map((c) => fixture.replies[c.id]);
      expect(replies.every((r) => r !== undefined)).toBe(true);
      expect(new Set(replies.map((r) => r?.emotion)).size).toBeGreaterThanOrEqual(5);
      expect(replies.filter((r) => r?.gesture !== undefined).length).toBeGreaterThanOrEqual(3);
      for (const r of replies) expect(r?.line, "p, b or m closes the lips").toMatch(/[pbm]/i);
    });
  }
});
