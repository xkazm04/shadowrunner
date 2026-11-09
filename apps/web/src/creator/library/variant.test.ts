// perfection-pass task 7 (requirement 7.3): rename and duplicate, as rules and on both stores.
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { memoryLibrary, openLibrary, readRecord, type CharacterRecord, type LibraryStore } from "./libraryStore";
import { canExport } from "./packing";
import { cleanName, NAME_MAX, renamed, sameArt, variantOf } from "./variant";

const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(id = "test-ghost", extra: Partial<CharacterRecord> = {}): CharacterRecord {
  const rig = testRig(id);
  return {
    id,
    rig,
    assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])),
    look: { ...defaultLook(rig), hidden: ["crown"] },
    voice: "velvet",
    createdAt: "2026-11-01T00:00:00.000Z",
    sheet: { archetype: "Drowned diver", hook: "Hums.", lines: ["Forty fathoms."] },
    ...extra,
  };
}

const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("the rules", () => {
  it("a name is trimmed, collapsed and capped; an empty one is refused", () => {
    expect(cleanName("  Night \n  Ghost ")).toBe("Night Ghost");
    expect(cleanName("   ")).toBeUndefined();
    expect(cleanName("x".repeat(NAME_MAX + 9))).toHaveLength(NAME_MAX);
  });

  it("the house character keeps his name; anyone else is renamed on rig.name only", () => {
    expect(renamed(record("malakor", { seeded: true }), "Bob")).toBeUndefined();
    const r = record();
    expect(renamed(r, "Test Ghost")).toBe(r);
    const next = renamed(r, "Night Ghost");
    expect(next?.rig.name).toBe("Night Ghost");
    expect(next?.rig.layers).toBe(r.rig.layers);
    expect(next !== undefined && sameArt(r.rig, next.rig)).toBe(true);
  });

  it("a variant has a free id, '(variant)', copies of look and images, now as createdAt", () => {
    const r = record();
    const v = variantOf(r, new Set(["test-ghost", "test-ghost-2"]), NOW);
    expect([v.id, v.rig.id, v.rig.name, v.createdAt]).toEqual(["test-ghost-3", "test-ghost-3", "Test Ghost (variant)", NOW.toISOString()]);
    expect(v.look).toEqual(r.look);
    expect(v.look).not.toBe(r.look);
    expect(v.assets).toEqual(r.assets);
    expect([v.voice, v.sheet]).toEqual([r.voice, r.sheet]);
    expect(readRecord(v).kind).toBe("ok");
    expect(variantOf(record("x", { rig: { ...testRig("x"), name: "n".repeat(NAME_MAX) } }), new Set(["x"]), NOW).rig.name).toHaveLength(NAME_MAX);
  });

  it("a variant of Malakor is not seeded but stays house art: deletable, never exported", () => {
    const house = record("malakor", { seeded: true });
    const v = variantOf(house, new Set(["malakor"]), NOW);
    expect(v.seeded).toBeUndefined();
    expect(v.house).toBe(true);
    expect(canExport(house)).toBe(false);
    expect(canExport(v)).toBe(false);
    expect(variantOf(v, new Set(["malakor", "malakor-2"]), NOW).house).toBe(true);
    expect(canExport(variantOf(record(), new Set(["test-ghost"]), NOW))).toBe(true);
  });
});

const stores: [string, () => Promise<LibraryStore>][] = [
  ["memory", async () => memoryLibrary()],
  ["IndexedDB", () => openLibrary(() => new IDBFactory())],
];

describe.each(stores)("on the %s store", (_name, open) => {
  it("rename rewrites rig.name only; refused for Malakor and an empty name; missing for no record", async () => {
    const store = await open();
    await store.put(record());
    await store.put(record("malakor", { seeded: true }));
    expect(await store.rename("test-ghost", "  Night Ghost ")).toBe("renamed");
    const got = await store.get("test-ghost");
    expect(got?.kind === "ok" ? [got.record.rig.name, got.record.look.hidden] : got).toEqual(["Night Ghost", ["crown"]]);
    expect(await store.rename("test-ghost", "  ")).toBe("refused");
    expect(await store.rename("malakor", "Bob")).toBe("refused");
    expect(await store.rename("nobody", "Bob")).toBe("missing");
  });

  it("duplicate stores a variant under a free id, readable, and the original is untouched", async () => {
    const store = await open();
    await store.put(record());
    await store.put(record("malakor", { seeded: true }));
    const id = await store.duplicate("test-ghost", NOW);
    expect(id).toBe("test-ghost-2");
    expect(await store.duplicate("test-ghost", NOW)).toBe("test-ghost-3");
    const copy = await store.get("test-ghost-2");
    expect(copy?.kind === "ok" ? [copy.record.rig.name, copy.record.look.hidden, Object.keys(copy.record.assets).length] : copy).toEqual(["Test Ghost (variant)", ["crown"], 8]);
    const house = await store.get((await store.duplicate("malakor", NOW)) ?? "");
    expect(house?.kind === "ok" ? [house.record.house, house.record.seeded] : house).toEqual([true, undefined]);
    expect(await store.remove("malakor-2")).toBe("deleted");
    expect(await store.duplicate("nobody")).toBeUndefined();
  });
});
