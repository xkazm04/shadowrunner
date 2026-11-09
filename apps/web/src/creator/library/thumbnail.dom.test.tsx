// @vitest-environment happy-dom
// perfection-pass task 9 (requirement 9.1): the strip's still is drawn from the saved look, decoding
// only what it draws at the size it draws it, and its key follows the record and look, not the name.
// The library keeps it: a second load of the same library decodes no layer image for the strip.
import { defaultLook, regionKey, type Look, type Rig } from "@sr/rig";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { lookReducer } from "../customize/lookReducer";
import { testRig } from "../testFixtures";
import { memoryLibrary, readRecord, type CharacterRecord, type LibraryStore } from "./libraryStore";
import { renderThumb, thumbQueue, type ThumbDeps } from "./thumbnail";
import { canonicalJson, thumbIsCurrent, thumbKey } from "./thumbKey";
import { useLibrary, type Library } from "./useLibrary";
import { variantOf } from "./variant";

/** A 2D context that records what is drawn (the canvas2D renderer's subset). */
function recordingDeps(): ThumbDeps & { decoded: { file: string; w: number; h: number; exact: boolean }[]; drawn: number } {
  const decoded: { file: string; w: number; h: number; exact: boolean }[] = [];
  const out = {
    decoded,
    drawn: 0,
    decode: async (blob: Blob, w: number, h: number, exact: boolean): Promise<ImageBitmap> => {
      decoded.push({ file: await blob.text(), w, h, exact });
      return { width: w, height: h, close: () => undefined };
    },
    canvas: (size: number): HTMLCanvasElement => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const noop = (): void => undefined;
      const ctx = { setTransform: noop, clearRect: noop, drawImage: () => (out.drawn += 1), globalAlpha: 1, filter: "none", imageSmoothingEnabled: true, imageSmoothingQuality: "high" };
      Reflect.set(canvas, "getContext", (kind: string) => (kind === "2d" ? ctx : null));
      return canvas;
    },
    encode: async (): Promise<Blob> => new Blob(["still"], { type: "image/webp" }),
  };
  return out;
}

/** testRig with a colour region on the head (its map named head.map.png). */
function regionRig(): Rig {
  const rig = testRig();
  return { ...rig, layers: rig.layers.map((l) => (l.name === "head" ? { ...l, regions: { map: "head.map.png", slots: [{ id: "skin", name: "skin", hex: "#808080" }] } } : l)) };
}

/** Each file's Blob holds its own name, so a decode says which file it was. */
function recordOf(rig: Rig = testRig(), look: Look = defaultLook(rig)): CharacterRecord {
  const files = [...rig.layers.map((l) => l.file), ...rig.layers.flatMap((l) => (l.regions === undefined ? [] : [l.regions.map]))];
  return { id: rig.id, rig, assets: Object.fromEntries(files.map((f) => [f, new Blob([f])])), look, voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

describe("renderThumb", () => {
  it("decodes each shown layer once, at the size the still draws it, and keys the still by record and look", async () => {
    const deps = recordingDeps();
    const rig = testRig();
    const record = recordOf(rig, lookReducer(defaultLook(rig), { type: "toggle", layer: "crown" }));
    const thumb = await renderThumb(record, deps, 160);
    expect(thumb?.key).toBe(thumbKey(record));
    // The crown is hidden by the look: not decoded, not drawn.
    expect(deps.decoded.map((d) => d.file).sort()).toEqual(rig.layers.filter((l) => l.name !== "crown").map((l) => l.file).sort());
    expect(deps.drawn).toBe(rig.layers.length - 1);
    // 64 px rig in a 160 px still: the head (32 x 36) is decoded at 80 x 90, not at its own size.
    expect(deps.decoded.find((d) => d.file === "head.png")).toEqual({ file: "head.png", w: 80, h: 90, exact: false });
  });

  it("a recoloured region asks for its map, decoded exactly (nearest), and the still is drawn again", async () => {
    const deps = recordingDeps();
    const rig = regionRig();
    const record = recordOf(rig, lookReducer(defaultLook(rig), { type: "region", key: regionKey("head", "skin"), value: "#ff0000" }));
    expect(await renderThumb(record, deps, 160)).toBeDefined();
    expect(deps.decoded.find((d) => d.file === "head.map.png")).toEqual({ file: "head.map.png", w: 80, h: 90, exact: true });
    expect(deps.drawn).toBe(2 * rig.layers.length);
  });

  it("a look equal to the rig draws in one pass and never decodes the map", async () => {
    const deps = recordingDeps();
    await renderThumb(recordOf(regionRig()), deps, 160);
    expect(deps.decoded.some((d) => d.file === "head.map.png")).toBe(false);
  });

  it("is undefined where there is no canvas", async () => {
    expect(await renderThumb(recordOf(), { ...recordingDeps(), canvas: () => undefined })).toBeUndefined();
  });
});

describe("thumbKey", () => {
  it("follows the id, createdAt and look; not the name", () => {
    const record = recordOf();
    const key = thumbKey(record);
    const renamed: CharacterRecord = { ...record, rig: { ...record.rig, name: "Renamed" } };
    expect(thumbKey(renamed)).toBe(key);
    expect(thumbKey({ ...record, createdAt: "2026-11-02T00:00:00.000Z" })).not.toBe(key);
    expect(thumbKey({ ...record, id: "other" })).not.toBe(key);
    expect(thumbKey({ ...record, look: lookReducer(record.look, { type: "shape", layer: "head", value: { size: 1.2 } }) })).not.toBe(key);
  });

  it("a look read back from the store keys the same as the reducer's (canonical JSON)", async () => {
    const rig = testRig();
    let look = defaultLook(rig);
    look = lookReducer(look, { type: "face", field: "gaze.range", value: 0.3, rig });
    look = lookReducer(look, { type: "shape", layer: "head", value: { rot: 10 } });
    look = lookReducer(look, { type: "palette", key: "eye", value: "#00FF00" });
    const record = recordOf(rig, look);
    const store = memoryLibrary();
    await store.put(record);
    const back = await store.get(record.id);
    expect(back?.kind === "ok" && thumbKey(back.record)).toBe(thumbKey(record));
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}');
  });
});

describe("the store keeps a still only over the look it shows", () => {
  it("saveThumb writes a current still, refuses a stale one, and the record reads it back", async () => {
    const store = memoryLibrary();
    const record = recordOf();
    await store.put(record);
    expect(await store.saveThumb(record.id, { blob: new Blob(["old"]), key: "stale" })).toBe(false);
    const thumb = { blob: new Blob(["still"]), key: thumbKey(record) };
    expect(await store.saveThumb(record.id, thumb)).toBe(true);
    expect(await store.saveThumb("missing", thumb)).toBe(false);
    const back = await store.get(record.id);
    expect(back?.kind === "ok" && back.record.thumb?.blob).toBe(thumb.blob);
    // A rename keeps it (and its key: the name is not in it).
    await store.rename(record.id, "Someone Else");
    const renamed = await store.get(record.id);
    expect(renamed?.kind === "ok" && thumbIsCurrent(renamed.record) && renamed.record.thumb?.blob).toBe(thumb.blob);
    // A malformed stored thumb is dropped on read.
    expect(readRecord({ ...record, thumb: { blob: "no", key: 1 } })).toMatchObject({ kind: "ok", record: { id: record.id } });
    const read = readRecord({ ...record, thumb: { blob: "no", key: 1 } });
    expect(read.kind === "ok" && read.record.thumb).toBeUndefined();
  });

  it("a duplicate carries the same still under its own key; a stale still is not carried", () => {
    const record = recordOf();
    const thumb = { blob: new Blob(["still"]), key: thumbKey(record) };
    const copy = variantOf({ ...record, thumb }, new Set([record.id]), new Date("2026-11-03T00:00:00.000Z"));
    expect(copy.thumb?.blob).toBe(thumb.blob);
    expect(copy.thumb !== undefined && thumbIsCurrent(copy)).toBe(true);
    expect(variantOf({ ...record, thumb: { ...thumb, key: "stale" } }, new Set([record.id])).thumb).toBeUndefined();
  });
});

describe("thumbQueue", () => {
  const manual = () => {
    const runs: [() => void, boolean][] = [];
    return { runs, schedule: (run: () => void, soon: boolean) => void runs.push([run, soon]) };
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  it("makes one still at a time, the latest record per id, soon for a record with none and idle for a stale one", async () => {
    const made: string[] = [];
    const got: string[] = [];
    const clock = manual();
    const queue = thumbQueue((id, t) => void got.push(`${id}:${t.key}`), {
      make: async (r) => {
        made.push(r.id);
        return { blob: new Blob([r.id]), key: thumbKey(r) };
      },
      schedule: clock.schedule,
    });
    const a = recordOf(testRig("a"));
    const b = recordOf(testRig("b"));
    queue.want(a);
    queue.want(b);
    expect(clock.runs).toHaveLength(1);
    expect(clock.runs[0]?.[1]).toBe(true);
    clock.runs[0]?.[0]();
    await flush();
    clock.runs[1]?.[0]();
    await flush();
    expect(made).toEqual(["a", "b"]);
    expect(got).toEqual([`a:${thumbKey(a)}`, `b:${thumbKey(b)}`]);
    // A current still is not made again; a look change (stale still) is made when idle.
    queue.want({ ...a, thumb: { blob: new Blob([]), key: thumbKey(a) } });
    expect(clock.runs).toHaveLength(2);
    const changed = { ...a, thumb: { blob: new Blob([]), key: thumbKey(a) }, look: lookReducer(a.look, { type: "emotion", emotion: "grim" }) };
    queue.want(changed);
    expect(clock.runs[2]?.[1]).toBe(false);
  });

  it("a still that cannot be made is not tried again for that key", async () => {
    const clock = manual();
    let tries = 0;
    const queue = thumbQueue(() => undefined, {
      make: async () => {
        tries += 1;
        return undefined;
      },
      schedule: clock.schedule,
    });
    const a = recordOf();
    queue.want(a);
    clock.runs[0]?.[0]();
    await flush();
    queue.want(a);
    expect(clock.runs).toHaveLength(1);
    expect(tries).toBe(1);
  });
});

describe("useLibrary keeps every record's still", () => {
  let view: Mounted | undefined;
  let seen: Library | undefined;
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
  });

  function Probe({ open, deps }: { open: () => Promise<LibraryStore>; deps: ThumbDeps }) {
    seen = useLibrary({ open, cast: async () => [], makeThumb: (r) => renderThumb(r, deps) });
    return null;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 30; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
  }

  const records = (): CharacterRecord[] => (seen?.entries ?? []).flatMap((e) => (e.kind === "ok" ? [e.record] : []));
  const twoRecords = (): CharacterRecord[] => [recordOf(testRig("ghost-a", "Ghost A")), { ...recordOf(testRig("ghost-b", "Ghost B")), createdAt: "2026-11-02T00:00:00.000Z" }];

  // The memory twin here (happy-dom's Blob does not survive fake-indexeddb's clone); the IndexedDB
  // store's half of this is thumbStore.test.ts, in node.
  it("a second load of the library decodes zero layer images for the strip", async () => {
    const memory = memoryLibrary();
    const open = () => Promise.resolve(memory);
    for (const record of twoRecords()) await memory.put(record);

    const first = recordingDeps();
    view = await mount(<Probe open={open} deps={first} />);
    await settle();
    expect(records()).toHaveLength(2);
    expect(records().every(thumbIsCurrent)).toBe(true);
    expect(first.decoded.length).toBeGreaterThan(0);
    await view.unmount();

    const second = recordingDeps();
    view = await mount(<Probe open={open} deps={second} />);
    await settle();
    expect(records()).toHaveLength(2);
    expect(records().every(thumbIsCurrent)).toBe(true);
    expect(second.decoded).toEqual([]);
  });

  it("a look save makes that record's still again (after the save, off the input path); a rename makes none", async () => {
    const store = memoryLibrary();
    for (const record of twoRecords()) await store.put(record);
    const deps = recordingDeps();
    view = await mount(<Probe open={async () => store} deps={deps} />);
    await settle();
    const before = records().find((r) => r.id === "ghost-a")?.thumb;
    deps.decoded.length = 0;

    await act(async () => seen?.rename("ghost-a", "Ghost Renamed"));
    await settle();
    expect(deps.decoded).toEqual([]);
    expect(records().find((r) => r.id === "ghost-a")?.thumb).toBe(before);

    const look = lookReducer(records().find((r) => r.id === "ghost-a")?.look ?? defaultLook(testRig()), { type: "toggle", layer: "crown" });
    await act(async () => seen?.saveLook("ghost-a", look));
    await settle();
    const after = records().find((r) => r.id === "ghost-a");
    expect(after?.thumb).not.toBe(before);
    expect(after !== undefined && thumbIsCurrent(after)).toBe(true);
    // Only ghost-a was drawn again, without its hidden crown.
    expect(deps.decoded.length).toBe(testRig().layers.length - 1);
    const stored = await store.get("ghost-a");
    expect(stored?.kind === "ok" && stored.record.thumb?.key).toBe(after?.thumb?.key);
  });

  it("add stores a record without the still it came with (its images may be new) and makes a fresh one", async () => {
    const store = memoryLibrary();
    const deps = recordingDeps();
    view = await mount(<Probe open={async () => store} deps={deps} />);
    await settle();
    const record = recordOf(testRig("ghost-c"));
    const old = { blob: new Blob(["old art"]), key: thumbKey(record) };
    await act(async () => seen?.add({ ...record, thumb: old }));
    await settle();
    const kept = records().find((r) => r.id === "ghost-c");
    expect(kept?.thumb).toBeDefined();
    expect(kept?.thumb?.blob).not.toBe(old.blob);
  });
});
