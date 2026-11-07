// forge-creator S1: a forged character's face-gate readings (why a family has no painted face)
// survive a reload of the IndexedDB library and the memory twin, and are not written into a pack
// (docs/pack-format.md: a library note, not part of the character).
import type { FaceGate } from "@sr/forge/faceGate";
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { memoryLibrary, openLibrary, type CharacterRecord } from "./libraryStore";
import { packInputOf } from "./packing";

const GATE: FaceGate = { joy: { reason: "iris", irisDriftPx: 7.2, limit: 4, attempts: 3 }, gloom: { reason: "budget" } };
const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(): CharacterRecord {
  const rig = testRig("forged-wisp", "Wisp");
  return { id: rig.id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])), look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-08T00:00:00.000Z", faceGate: GATE };
}

describe("face-gate readings in the library", () => {
  it("survive a reload of the IndexedDB library", async () => {
    const factory = new IDBFactory();
    await (await openLibrary(() => factory)).put(record());
    const entry = await (await openLibrary(() => factory)).get("forged-wisp");
    expect(entry?.kind === "ok" && entry.record.faceGate).toEqual(GATE);
  });

  it("survive the memory twin", async () => {
    const memory = memoryLibrary();
    await memory.put(record());
    const entry = await memory.get("forged-wisp");
    expect(entry?.kind === "ok" && entry.record.faceGate).toEqual(GATE);
  });

  it("are not written into a pack", () => {
    expect("faceGate" in packInputOf(record(), { licence: "CC0-1.0" })).toBe(false);
  });
});
