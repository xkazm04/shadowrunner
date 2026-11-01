import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { blobToDataUrl, dataUrlToBlob, urlToBlob } from "./assets";
import { DB_NAME, openLibrary, readRecord, STORE, type CharacterRecord, type LibraryStore } from "./libraryStore";
import { loadMalakor, MALAKOR_ID, seedIfEmpty } from "./seed";

const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(id = "test-ghost", extra: Partial<CharacterRecord> = {}): CharacterRecord {
  const rig = testRig(id);
  return {
    id,
    rig,
    assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])),
    look: defaultLook(rig),
    voice: "velvet",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

const okIds = async (store: LibraryStore): Promise<string[]> =>
  (await store.list()).flatMap((e) => (e.kind === "ok" ? [e.record.id] : []));

const fakeMalakor = () => loadMalakor(async () => new Response(png()), () => new Date("2026-10-31T00:00:00.000Z"));

/** Writes a raw value straight into the object store, past the adapter. */
async function rawPut(factory: IDBFactory, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("library on IndexedDB (fake-indexeddb)", () => {
  it("opens sr-library / characters and is persistent", async () => {
    const factory = new IDBFactory();
    const store = await openLibrary(() => factory);
    expect(store.persistent).toBe(true);
    await store.put(record());
    expect(await okIds(await openLibrary(() => factory))).toEqual(["test-ghost"]);
  });

  it("seeds Malakor when empty, with his default look, and only then", async () => {
    const store = await openLibrary(() => new IDBFactory());
    expect(await seedIfEmpty(store, fakeMalakor)).toBe(true);
    expect(await seedIfEmpty(store, fakeMalakor)).toBe(false);
    const [entry] = await store.list();
    expect(entry?.kind).toBe("ok");
    if (entry?.kind !== "ok") return;
    expect(entry.record.id).toBe(MALAKOR_ID);
    expect(entry.record.seeded).toBe(true);
    expect(entry.record.look).toEqual(defaultLook(entry.record.rig));
    expect(entry.record.rig.layers.length).toBe(18);
    for (const layer of entry.record.rig.layers) expect(entry.record.assets[layer.file]).toBeInstanceOf(Blob);
  });

  it("lists a record whose rig does not validate as damaged, never as a character", async () => {
    const factory = new IDBFactory();
    const store = await openLibrary(() => factory);
    await store.put(record());
    const bad = record("bad-one");
    await rawPut(factory, { ...bad, rig: { ...bad.rig, version: 2 } });
    const entries = await store.list();
    expect(entries.find((e) => e.kind === "damaged")).toMatchObject({ id: "bad-one", name: "Test Ghost" });
    expect(await okIds(store)).toEqual(["test-ghost"]);
  });

  it("lists a record missing a layer image as damaged", async () => {
    const factory = new IDBFactory();
    const r = record("no-head");
    const rest = Object.fromEntries(Object.entries(r.assets).filter(([file]) => file !== "head.png"));
    await openLibrary(() => factory);
    await rawPut(factory, { ...r, assets: rest });
    expect((await (await openLibrary(() => factory)).list())[0]?.kind).toBe("damaged");
  });

  it("refuses to delete the seeded Malakor and deletes anything else", async () => {
    const store = await openLibrary(() => new IDBFactory());
    await seedIfEmpty(store, fakeMalakor);
    await store.put(record());
    expect(await store.remove(MALAKOR_ID)).toBe("refused");
    expect(await store.remove("test-ghost")).toBe("deleted");
    expect(await store.remove("test-ghost")).toBe("missing");
    expect(await okIds(store)).toEqual([MALAKOR_ID]);
  });

  it("saving a look updates only the look", async () => {
    const store = await openLibrary(() => new IDBFactory());
    const r = record();
    await store.put(r);
    const look = { ...r.look, emotion: "grim" as const, hidden: ["monocle"] };
    expect(await store.saveLook(r.id, look)).toBe(true);
    const entry = await store.get(r.id);
    expect(entry?.kind === "ok" && entry.record.look).toEqual(look);
    expect(entry?.kind === "ok" && entry.record.voice).toBe("velvet");
    expect(entry?.kind === "ok" && entry.record.createdAt).toBe(r.createdAt);
    expect(await store.saveLook("nobody", look)).toBe(false);
  });
});

describe("in-memory fallback", () => {
  it("is used when indexedDB is undefined, and says it is not persistent", async () => {
    const store = await openLibrary(() => undefined);
    expect(store.persistent).toBe(false);
    await seedIfEmpty(store, fakeMalakor);
    expect(await okIds(store)).toEqual([MALAKOR_ID]);
    expect(await store.remove(MALAKOR_ID)).toBe("refused");
  });

  it("is used when reading indexedDB throws or the open fails", async () => {
    expect((await openLibrary(() => { throw new Error("SecurityError"); })).persistent).toBe(false);
    const broken = { open: () => { throw new Error("InvalidStateError"); } };
    expect((await openLibrary(() => Object.assign(new IDBFactory(), broken))).persistent).toBe(false);
  });
});

describe("readRecord", () => {
  it("repairs an unreadable look and voice when the rig and images are sound", () => {
    const r = record();
    const entry = readRecord({ ...r, look: { palette: "red" }, voice: "kazoo" });
    expect(entry.kind === "ok" && entry.record.look).toEqual(defaultLook(r.rig));
    expect(entry.kind === "ok" && entry.record.voice).toBe("crypt");
  });

  it("refuses a record whose id is not its rig's", () => {
    expect(readRecord({ ...record(), id: "other" }).kind).toBe("damaged");
  });
});

describe("assets", () => {
  it("data: URL <-> Blob round-trips the bytes and type", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 250, 255])], { type: "image/png" });
    const url = await blobToDataUrl(blob);
    const back = dataUrlToBlob(url);
    expect(back?.type).toBe("image/png");
    expect([...new Uint8Array(await (back ?? new Blob()).arrayBuffer())]).toEqual([0, 1, 2, 250, 255]);
  });

  it("reads a URL through the fetcher, and refuses a failed fetch", async () => {
    expect((await urlToBlob("/x.png", async () => new Response(png()))).size).toBe(4);
    await expect(urlToBlob("/x.png", async () => new Response("", { status: 404 }))).rejects.toThrow();
    expect(dataUrlToBlob("not a data url")).toBeUndefined();
  });
});
