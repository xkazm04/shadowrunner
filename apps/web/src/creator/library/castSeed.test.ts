// Creator task 9: the whole cast is seeded once, old libraries are topped up, nothing is duplicated
// or overwritten, and a preset the user deleted stays deleted (fake-indexeddb and the memory twin).
import { defaultLook } from "@sr/rig";
import fc from "fast-check";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { DB_NAME, memoryLibrary, openLibrary, readSeedLedger, STORE, type CharacterRecord, type LibraryStore } from "./libraryStore";
import { seedCast, type CastSeed } from "./seed";

const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function record(id: string, seeded = false): CharacterRecord {
  const rig = testRig(id, `Name of ${id}`);
  const r: CharacterRecord = {
    id,
    rig,
    assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])),
    look: defaultLook(rig),
    voice: "crypt",
    createdAt: "2026-11-01T00:00:00.000Z",
  };
  if (seeded) r.seeded = true;
  return r;
}

/** Malakor (protected) and three presets; counts every load. */
function cast(ids = ["malakor", "replay-a", "replay-b", "replay-c"]) {
  const loads: string[] = [];
  const members: CastSeed[] = ids.map((id, i) => ({
    id,
    load: async () => {
      loads.push(id);
      return record(id, i === 0);
    },
  }));
  return { members, loads };
}

const okIds = async (store: LibraryStore): Promise<string[]> => (await store.list()).flatMap((e) => (e.kind === "ok" ? [e.record.id] : []));
const clock = () => new Date("2026-11-01T12:00:00.000Z");

describe("seedCast", () => {
  it("seeds the whole cast on first run, in cast order, Malakor protected and the presets deletable", async () => {
    const store = await openLibrary(() => new IDBFactory());
    const { members } = cast();
    expect(await seedCast(store, members, { now: clock })).toEqual(["malakor", "replay-a", "replay-b", "replay-c"]);
    expect(await okIds(store)).toEqual(["malakor", "replay-a", "replay-b", "replay-c"]);
    expect(await store.remove("malakor")).toBe("refused");
    expect(await store.remove("replay-b")).toBe("deleted");
  });

  it("is idempotent across reloads: the second visit loads nothing and adds nothing", async () => {
    const factory = new IDBFactory();
    await seedCast(await openLibrary(() => factory), cast().members, { now: clock });
    const again = cast();
    const reopened = await openLibrary(() => factory);
    expect(await seedCast(reopened, again.members, { now: clock })).toEqual([]);
    expect(again.loads).toEqual([]);
    expect(await okIds(reopened)).toHaveLength(4);
  });

  it("never puts back a preset the user deleted; the gallery can still re-adopt it", async () => {
    const factory = new IDBFactory();
    const store = await openLibrary(() => factory);
    await seedCast(store, cast().members, { now: clock });
    await store.remove("replay-a");
    await seedCast(await openLibrary(() => factory), cast().members, { now: clock });
    expect(await okIds(store)).not.toContain("replay-a");
    await store.put(record("replay-a"));
    expect(await okIds(store)).toContain("replay-a");
  });

  it("adds a new recorded job to an already seeded library once", async () => {
    const store = memoryLibrary();
    await seedCast(store, cast().members);
    expect(await seedCast(store, cast(["malakor", "replay-a", "replay-b", "replay-c", "replay-new"]).members)).toEqual(["replay-new"]);
  });

  it("tops up an old (version 1) library without touching its Malakor or a preset adopted with an edited look", async () => {
    const factory = new IDBFactory();
    // A library from before the cast: database version 1, `characters` only.
    const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const edited = { ...record("replay-b"), look: { ...defaultLook(testRig("replay-b")), emotion: "furious" as const } };
    await new Promise<void>((resolve, reject) => {
      const tx = v1.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record("malakor", true));
      tx.objectStore(STORE).put(edited);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    v1.close();
    const store = await openLibrary(() => factory);
    const { members, loads } = cast();
    expect(await seedCast(store, members, { now: clock })).toEqual(["replay-a", "replay-c"]);
    expect(loads).toEqual(["replay-a", "replay-c"]);
    const b = await store.get("replay-b");
    expect(b?.kind === "ok" && b.record.look.emotion).toBe("furious");
    expect((await okIds(store)).sort()).toEqual(["malakor", "replay-a", "replay-b", "replay-c"]);
    expect(await store.seededIds()).toEqual(["malakor", "replay-a", "replay-b", "replay-c"]);
  });

  it("does not seed over a damaged record with the same id", async () => {
    const store = memoryLibrary();
    // A rig of an unknown version: it reads back as damaged.
    await store.put({ ...record("replay-a"), rig: Object.assign(testRig("replay-a"), { version: 2 }) });
    const { members, loads } = cast();
    await seedCast(store, members);
    expect(loads).not.toContain("replay-a");
    expect((await store.list()).find((e) => e.kind === "damaged")?.id).toBe("replay-a");
  });

  it("skips a member that fails to load and tries it again on the next visit", async () => {
    const store = memoryLibrary();
    let fail = true;
    const members: CastSeed[] = [
      { id: "malakor", load: async () => record("malakor", true) },
      {
        id: "replay-a",
        load: async () => {
          if (fail) throw new Error("offline");
          return record("replay-a");
        },
      },
    ];
    expect(await seedCast(store, members)).toEqual(["malakor"]);
    fail = false;
    expect(await seedCast(store, members)).toEqual(["replay-a"]);
  });

  it("with `only`, seeds just those members now and the rest on the next pass, still in cast order", async () => {
    const store = memoryLibrary();
    const { members } = cast();
    const added: string[] = [];
    expect(await seedCast(store, members, { now: clock, only: new Set(["malakor", "replay-c"]) })).toEqual(["malakor", "replay-c"]);
    await seedCast(store, members, { now: clock, onAdded: (id) => added.push(id) });
    expect(added).toEqual(["replay-a", "replay-b"]);
    expect(await okIds(store)).toEqual(["malakor", "replay-a", "replay-b", "replay-c"]);
  });

  it("reads only a well-formed ledger", () => {
    expect(readSeedLedger({ key: "cast-seed", version: 1, ids: ["a"] })).toEqual(["a"]);
    expect(readSeedLedger({ key: "cast-seed", version: 9, ids: ["a"] })).toBeUndefined();
    expect(readSeedLedger({ ids: [1] })).toBeUndefined();
    expect(readSeedLedger(undefined)).toBeUndefined();
  });
});

type Op = { kind: "visit"; cast: number } | { kind: "delete"; id: string } | { kind: "edit"; id: string } | { kind: "adopt"; id: string };

const IDS = ["malakor", "replay-a", "replay-b", "replay-c", "replay-d"];

describe("seedCast over any history of visits, deletes, edits and adoptions (property)", () => {
  it("never duplicates, never overwrites a kept look, never revives a delete, and keeps Malakor", async () => {
    const id = fc.constantFrom(...IDS);
    const op: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ kind: fc.constant("visit" as const), cast: fc.integer({ min: 1, max: IDS.length }) }),
      fc.record({ kind: fc.constant("delete" as const), id }),
      fc.record({ kind: fc.constant("edit" as const), id }),
      fc.record({ kind: fc.constant("adopt" as const), id }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 25 }), async (ops) => {
        const store = memoryLibrary();
        const deletedAfterSeen = new Set<string>();
        const looks = new Map<string, string>();
        let offered = new Set<string>();
        for (const o of ops) {
          if (o.kind === "visit") {
            const members = cast(IDS.slice(0, o.cast)).members;
            await seedCast(store, members);
            offered = new Set([...offered, ...members.map((m) => m.id)]);
          } else if (o.kind === "delete") {
            if ((await store.remove(o.id)) === "deleted" && offered.has(o.id)) deletedAfterSeen.add(o.id);
          } else if (o.kind === "edit") {
            const emotion = looks.get(o.id) === "grim" ? "smug" : "grim";
            if (await store.saveLook(o.id, { ...defaultLook(testRig(o.id)), emotion })) looks.set(o.id, emotion);
          } else {
            await store.put(record(o.id, o.id === "malakor"));
            looks.delete(o.id);
            deletedAfterSeen.delete(o.id);
          }
          const entries = await store.list();
          const ids = entries.map((e) => (e.kind === "ok" ? e.record.id : e.id));
          expect(new Set(ids).size).toBe(ids.length);
          for (const [lookId, emotion] of looks) {
            const e = entries.find((x) => x.kind === "ok" && x.record.id === lookId);
            if (e?.kind === "ok") expect(e.record.look.emotion).toBe(emotion);
          }
          for (const gone of deletedAfterSeen) expect(ids).not.toContain(gone);
          if (offered.has("malakor")) expect(ids).toContain("malakor");
          // Every offered member is either present or one the user deleted.
          for (const m of offered) expect(ids.includes(m) || deletedAfterSeen.has(m)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});
