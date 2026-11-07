// tiger L1: a live-forged rig's signature acts (`Layer.act`) survive a library reload and a .srpack
// export and import, untouched.
import { readPack, writePack } from "@sr/pack";
import { defaultLook, type Rig } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { openLibrary, type CharacterRecord } from "./libraryStore";
import { packInputOf, recordOfPack } from "./packing";

const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function actedRig(): Rig {
  const rig = testRig("forged-lot", "Lot");
  return { ...rig, layers: rig.layers.map((l) => (l.name === "monocle" ? { ...l, act: { cue: ["sold"], gain: 2, s: 0.8 } } : l.name === "crown" ? { ...l, act: { cue: ["ring"] } } : l)) };
}

function record(): CharacterRecord {
  const rig = actedRig();
  return { id: rig.id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])), look: defaultLook(rig), voice: "choir", createdAt: "2026-11-08T00:00:00.000Z" };
}

const actsOf = (rig: Rig) => rig.layers.flatMap((l) => (l.act === undefined ? [] : [[l.name, l.act]]));
const EXPECTED = [
  ["crown", { cue: ["ring"] }],
  ["monocle", { cue: ["sold"], gain: 2, s: 0.8 }],
];

describe("signature acts in the library and in a pack", () => {
  it("survive a reload of the IndexedDB library", async () => {
    const factory = new IDBFactory();
    await (await openLibrary(() => factory)).put(record());
    const entry = await (await openLibrary(() => factory)).get("forged-lot");
    expect(entry?.kind).toBe("ok");
    if (entry?.kind === "ok") expect(actsOf(entry.record.rig)).toEqual(EXPECTED);
  });

  it("survive a .srpack export and import", async () => {
    const read = await readPack(await writePack(packInputOf(record(), { licence: "CC0-1.0" })));
    if (!read.ok) throw new Error(read.error.detail);
    expect(actsOf(recordOfPack(read.pack, new Set()).rig)).toEqual(EXPECTED);
  });
});
