// C4: a forged character's sheet (archetype, hook, example lines) survives a library reload and a
// .srpack export and import; a record without one keeps having none; a bad stored sheet is dropped.
import { readPack, writePack, type CharacterSheet } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { openLibrary, readRecord, type CharacterRecord } from "./libraryStore";
import { packInputOf, recordOfPack } from "./packing";

const SHEET: CharacterSheet = { archetype: "Drowned diver", hook: "Hums shanties between lines.", lines: ["Forty fathoms of chat.", "Bubbles mean I laugh."] };
const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(extra: Partial<CharacterRecord> = {}): CharacterRecord {
  const rig = testRig("forged-brine", "Brine");
  return {
    id: rig.id,
    rig,
    assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])),
    look: defaultLook(rig),
    voice: "choir",
    createdAt: "2026-11-07T00:00:00.000Z",
    ...extra,
  };
}

describe("character sheet in the library", () => {
  it("survives a reload of the IndexedDB library", async () => {
    const factory = new IDBFactory();
    await (await openLibrary(() => factory)).put(record({ sheet: SHEET }));
    const entry = await (await openLibrary(() => factory)).get("forged-brine");
    expect(entry?.kind === "ok" && entry.record.sheet).toEqual(SHEET);
  });

  it("a record without a sheet reads without one; a sheet that does not read is dropped, the record kept", () => {
    const plain = readRecord(record());
    expect(plain.kind === "ok" && "sheet" in plain.record).toBe(false);
    const bad = readRecord({ ...record(), sheet: { archetype: "x", hook: "y", lines: ["a", "b", "c", "d"] } });
    expect(bad.kind).toBe("ok");
    expect(bad.kind === "ok" && "sheet" in bad.record).toBe(false);
  });
});

describe("character sheet in a pack", () => {
  it("survives export and import, and on an id clash the copy keeps it", async () => {
    const read = await readPack(await writePack(packInputOf(record({ sheet: SHEET }), { licence: "CC0-1.0" })));
    if (!read.ok) throw new Error(read.error.detail);
    expect(recordOfPack(read.pack, new Set()).sheet).toEqual(SHEET);
    expect(recordOfPack(read.pack, new Set(["forged-brine"])).sheet).toEqual(SHEET);
  });

  it("a record without a sheet exports a pack without one and imports without one", async () => {
    const input = packInputOf(record(), { licence: "CC0-1.0" });
    expect("sheet" in input).toBe(false);
    const read = await readPack(await writePack(input));
    if (!read.ok) throw new Error(read.error.detail);
    expect("sheet" in recordOfPack(read.pack, new Set())).toBe(false);
  });
});
