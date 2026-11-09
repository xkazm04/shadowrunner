// perfection-pass task 9 (requirement 9.1), the IndexedDB half of "a second load decodes nothing":
// a still written with saveThumb is read back on a fresh open as current, so the strip's queue has
// nothing to make; a stale one is refused, and a look save leaves the old still (stale) in place.
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { lookReducer } from "../customize/lookReducer";
import { testRig } from "../testFixtures";
import { openLibrary, type CharacterRecord } from "./libraryStore";
import { packInputOf } from "./packing";
import { thumbQueue } from "./thumbnail";
import { thumbIsCurrent, thumbKey } from "./thumbKey";

function record(): CharacterRecord {
  const rig = testRig("forged-ghost");
  return { id: rig.id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.file])])), look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

describe("the still in IndexedDB", () => {
  it("survives a reopen as current, so a second load makes (and decodes) nothing", async () => {
    const factory = new IDBFactory();
    const first = await openLibrary(() => factory);
    expect(first.persistent).toBe(true);
    const r = record();
    await first.put(r);
    const thumb = { blob: new Blob(["still"], { type: "image/webp" }), key: thumbKey(r) };
    expect(await first.saveThumb(r.id, { ...thumb, key: "stale" })).toBe(false);
    expect(await first.saveThumb(r.id, thumb)).toBe(true);

    const second = await openLibrary(() => factory);
    const [entry] = await second.list();
    if (entry?.kind !== "ok") throw new Error("the record did not read back");
    expect(thumbIsCurrent(entry.record)).toBe(true);
    expect(await entry.record.thumb?.blob.text()).toBe("still");
    let made = 0;
    const queue = thumbQueue(() => undefined, {
      make: async () => {
        made += 1;
        return undefined;
      },
      schedule: (run) => run(),
    });
    queue.want(entry.record);
    await Promise.resolve();
    expect(made).toBe(0);
  });

  it("a look save keeps the old still, now stale (the strip shows it until the new one is made)", async () => {
    const store = await openLibrary(() => new IDBFactory());
    const r = record();
    await store.put(r);
    await store.saveThumb(r.id, { blob: new Blob(["still"]), key: thumbKey(r) });
    await store.saveLook(r.id, lookReducer(r.look, { type: "emotion", emotion: "grim" }));
    const entry = await store.get(r.id);
    expect(entry?.kind === "ok" && entry.record.thumb !== undefined).toBe(true);
    expect(entry?.kind === "ok" && thumbIsCurrent(entry.record)).toBe(false);
  });

  it("a pack never carries the still (docs/pack-format.md is unchanged)", () => {
    const r = record();
    const input = packInputOf({ ...r, thumb: { blob: new Blob(["still"]), key: thumbKey(r) } }, { licence: "CC-BY-4.0" });
    expect(Object.keys(input)).not.toContain("thumb");
    expect(Object.keys(input.files).sort()).toEqual(Object.keys(r.assets).sort());
  });
});
