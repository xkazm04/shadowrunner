// The character library (creator requirement 2, task 3.2): IndexedDB database `sr-library`, object
// store `characters` (keyPath "id"), with an in-memory twin when IndexedDB is unavailable.
//
// Decisions the spec leaves open:
// - Every record read (IndexedDB or memory) goes through `readRecord`: the rig through
//   `validateRig`, and every layer file must have a Blob. Anything less is a `damaged` entry
//   (listed, never rendered). A record whose look or voice is unreadable but whose rig and assets
//   are sound is repaired on read (defaultLook / the default voice), since nothing is lost.
// - `saveLook` / `saveVoice` rewrite only that field of the stored record (read-modify-write in one
//   readwrite transaction). Deleting the seeded record is refused by the store itself, so no UI
//   path can delete Malakor.
// - The memory twin also keeps Blobs as given (no structured clone), which is what IndexedDB
//   would hand back.
// - The cast seed (creator task 9) keeps a ledger of the character ids it has ever placed, in a
//   second object store `meta` (database version 2), so a preset the user deleted is not put back
//   and a new recorded job still joins an old library once.
// - perfection-pass task 7: `rename` and `duplicate` follow library/variant.ts. A rename rewrites
//   only rig.name; a duplicate reads the stored record (through `readRecord`, so a damaged one is
//   not copied) and writes the variant in the same readwrite transaction that chose its free id.
import { VOICE_IDS, type VoiceId } from "@sr/engine";
import { readFaceGate, type FaceGate } from "@sr/forge/faceGate";
import { readSheet, type CharacterSheet } from "@sr/pack";
import { defaultLook, readLook, validateRig, type Look, type Rig } from "@sr/rig";
import { extraFiles } from "./assets";
import { renamed, variantOf } from "./variant";

export const DB_NAME = "sr-library";
export const STORE = "characters";
export const META_STORE = "meta";
export const DB_VERSION = 2;
const SEED_KEY = "cast-seed";
/** The ledger format; bump when the meaning of the ids changes. */
export const SEED_VERSION = 1;
export const DEFAULT_VOICE: VoiceId = "crypt";

export interface CharacterRecord {
  /** = rig.id */
  id: string;
  rig: Rig;
  /** Keyed by Layer.file. */
  assets: Record<string, Blob>;
  look: Look;
  voice: VoiceId;
  /** ISO 8601. */
  createdAt: string;
  /** Malakor; cannot be deleted. */
  seeded?: true;
  /** A variant of Malakor (library/variant.ts): his art, so never exported; may be renamed and deleted. */
  house?: true;
  /** Who a forged character is on air: its approved brief (C4). Omitted when it has none. */
  sheet?: CharacterSheet;
  /**
   * forge-creator S1: the forge's reading of each family it painted no face for (why: the eyes
   * moved, it repainted outside the brows, ...), so the Face tab can say so after a reload. A
   * library note only: packs do not carry it (docs/pack-format.md). Omitted when there is none.
   */
  faceGate?: FaceGate;
  /**
   * forge-creator S2: the live forge job a character was kept from, while one face may be repainted
   * (`POST /api/forge/:jobId/faces`, open until `expiresAt`, epoch ms), and the brief's eyes line the
   * repaint starts from. A library note only: packs do not carry it. Omitted for recorded, replay
   * and imported characters.
   */
  source?: CharacterSource;
}

export interface CharacterSource {
  jobId: string;
  expiresAt: number;
  /** The words after "Its eyes are" (the brief's face.eyes); omitted when the brief had none. */
  eyes?: string;
}

/** A stored source, or undefined when it is off-contract (the record then has no repaint). */
export function readSource(v: unknown): CharacterSource | undefined {
  if (!isRecord(v) || typeof v.jobId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v.jobId)) return undefined;
  if (typeof v.expiresAt !== "number" || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= 0) return undefined;
  if (v.eyes !== undefined && (typeof v.eyes !== "string" || v.eyes.length > 200)) return undefined;
  return { jobId: v.jobId, expiresAt: v.expiresAt, ...(typeof v.eyes === "string" && v.eyes.trim() !== "" ? { eyes: v.eyes } : {}) };
}

export type LibraryEntry =
  | { kind: "ok"; record: CharacterRecord }
  | { kind: "damaged"; id: string; name?: string; reason: string };

export type RemoveResult = "deleted" | "refused" | "missing";
/** "refused": the house character, or an empty name. */
export type RenameResult = "renamed" | "refused" | "missing";

export interface LibraryStore {
  /** False on the in-memory twin: nothing is kept after the tab closes. */
  readonly persistent: boolean;
  /** Every record, oldest first, each checked by `readRecord`. */
  list(): Promise<LibraryEntry[]>;
  get(id: string): Promise<LibraryEntry | undefined>;
  /** Adds or replaces a whole record. */
  put(record: CharacterRecord): Promise<void>;
  /** Updates only `look`; false when there is no such record. */
  saveLook(id: string, look: Look): Promise<boolean>;
  /** Updates only `voice`; false when there is no such record. */
  saveVoice(id: string, voice: VoiceId): Promise<boolean>;
  /** Refused for a seeded record. */
  remove(id: string): Promise<RemoveResult>;
  /** Sets rig.name (library/variant.ts `renamed`). */
  rename(id: string, name: string): Promise<RenameResult>;
  /** Stores a variant of the record (library/variant.ts `variantOf`); its new id, or undefined when there is no readable record. */
  duplicate(id: string, now?: Date): Promise<string | undefined>;
  /** The ids the cast seed has placed so far; undefined when it never ran (a new or pre-cast library). */
  seededIds(): Promise<string[] | undefined>;
  /** Replaces the cast seed's ledger. */
  writeSeededIds(ids: readonly string[]): Promise<void>;
}

/** A stored seed ledger, or undefined when it is missing or unreadable (the seed then only adds what is absent). */
export function readSeedLedger(value: unknown): string[] | undefined {
  if (!isRecord(value) || value.version !== SEED_VERSION || !Array.isArray(value.ids)) return undefined;
  return value.ids.every((id): id is string => typeof id === "string") ? [...value.ids] : undefined;
}

const ledgerOf = (ids: readonly string[]) => ({ key: SEED_KEY, version: SEED_VERSION, ids: [...new Set(ids)] });

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

export const isVoiceId = (v: unknown): v is VoiceId => typeof v === "string" && (VOICE_IDS as readonly string[]).includes(v);

export { readLook };

/** One stored value as a library entry: a checked record, or damaged with the reason. */
export function readRecord(value: unknown): LibraryEntry {
  const id = isRecord(value) && typeof value.id === "string" ? value.id : "(unknown)";
  const name = isRecord(value) && isRecord(value.rig) && typeof value.rig.name === "string" ? value.rig.name : undefined;
  const damaged = (reason: string): LibraryEntry => (name === undefined ? { kind: "damaged", id, reason } : { kind: "damaged", id, name, reason });
  if (!isRecord(value)) return damaged("not a character record");
  const rig = validateRig(value.rig);
  if (!rig.ok) return damaged(`rig does not validate: ${rig.errors[0]?.message ?? "unknown"}`);
  if (rig.value.id !== value.id) return damaged("record id does not match the rig");
  const assets = value.assets;
  if (!isRecord(assets)) return damaged("no layer images");
  const blobs: Record<string, Blob> = {};
  for (const layer of rig.value.layers) {
    const blob = assets[layer.file];
    if (!(blob instanceof Blob)) return damaged(`missing the image for layer ${layer.name}`);
    blobs[layer.file] = blob;
  }
  // Region maps and expression patches are kept when stored; without one the base art is drawn.
  for (const file of extraFiles(rig.value)) {
    const blob = assets[file];
    if (blob instanceof Blob) blobs[file] = blob;
  }
  const record: CharacterRecord = {
    id: rig.value.id,
    rig: rig.value,
    assets: blobs,
    look: readLook(value.look, rig.value) ?? defaultLook(rig.value),
    voice: isVoiceId(value.voice) ? value.voice : DEFAULT_VOICE,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
  };
  if (value.seeded === true) record.seeded = true;
  else if (value.house === true) record.house = true;
  // A sheet that does not read is dropped (the stage then treats the character as before C4).
  const sheet = value.sheet === undefined ? undefined : readSheet(value.sheet);
  if (sheet !== undefined) record.sheet = sheet;
  // S1: malformed readings are dropped (the Face tab then says what it said before them).
  const faceGate = readFaceGate(value.faceGate);
  if (faceGate !== undefined) record.faceGate = faceGate;
  // S2: a malformed source is dropped (the Face tab then offers no repaint).
  const source = readSource(value.source);
  if (source !== undefined) record.source = source;
  return { kind: "ok", record };
}

const byCreated = (a: LibraryEntry, b: LibraryEntry): number => {
  const at = a.kind === "ok" ? a.record.createdAt : "";
  const bt = b.kind === "ok" ? b.record.createdAt : "";
  return at.localeCompare(bt);
};

/** The in-memory twin (private mode, no IndexedDB). */
export function memoryLibrary(): LibraryStore {
  const rows = new Map<string, unknown>();
  let ledger: unknown;
  const patch = (id: string, field: "look" | "voice", value: unknown): boolean => {
    const row = rows.get(id);
    if (!isRecord(row)) return false;
    rows.set(id, { ...row, [field]: value });
    return true;
  };
  return {
    persistent: false,
    list: async () => [...rows.values()].map(readRecord).sort(byCreated),
    get: async (id) => (rows.has(id) ? readRecord(rows.get(id)) : undefined),
    put: async (record) => {
      rows.set(record.id, { ...record });
    },
    saveLook: async (id, look) => patch(id, "look", look),
    saveVoice: async (id, voice) => patch(id, "voice", voice),
    rename: async (id, name) => {
      const row = rows.get(id);
      if (row === undefined) return "missing";
      const entry = readRecord(row);
      const next = entry.kind === "ok" ? renamed(entry.record, name) : undefined;
      if (next === undefined || !isRecord(row) || !isRecord(row.rig)) return "refused";
      rows.set(id, { ...row, rig: { ...row.rig, name: next.rig.name } });
      return "renamed";
    },
    duplicate: async (id, now) => {
      const entry = rows.has(id) ? readRecord(rows.get(id)) : undefined;
      if (entry?.kind !== "ok") return undefined;
      const copy = variantOf(entry.record, new Set(rows.keys()), now);
      rows.set(copy.id, { ...copy });
      return copy.id;
    },
    remove: async (id) => {
      const row = rows.get(id);
      if (row === undefined) return "missing";
      if (isRecord(row) && row.seeded === true) return "refused";
      rows.delete(id);
      return "deleted";
    },
    seededIds: async () => readSeedLedger(ledger),
    writeSeededIds: async (ids) => {
      ledger = ledgerOf(ids);
    },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Version 1 had `characters` only; its records are kept as they are.
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(META_STORE)) req.result.createObjectStore(META_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is unavailable"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

/** The IndexedDB library over an open database. */
export function idbLibrary(db: IDBDatabase): LibraryStore {
  const patch = async (id: string, field: "look" | "voice", value: unknown): Promise<boolean> => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const finished = done(tx);
    const row: unknown = await request(store.get(id));
    if (!isRecord(row)) {
      await finished;
      return false;
    }
    store.put({ ...row, [field]: value });
    await finished;
    return true;
  };
  return {
    persistent: true,
    async list() {
      const rows: unknown[] = await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
      return rows.map(readRecord).sort(byCreated);
    },
    async get(id) {
      const row: unknown = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
      return row === undefined ? undefined : readRecord(row);
    },
    async put(record) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      await done(tx);
    },
    saveLook: (id, look) => patch(id, "look", look),
    saveVoice: (id, voice) => patch(id, "voice", voice),
    async rename(id, name) {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const finished = done(tx);
      const row: unknown = await request(store.get(id));
      let result: RenameResult = "renamed";
      const entry = row === undefined ? undefined : readRecord(row);
      const next = entry?.kind === "ok" ? renamed(entry.record, name) : undefined;
      if (row === undefined) result = "missing";
      else if (next === undefined || !isRecord(row) || !isRecord(row.rig)) result = "refused";
      else store.put({ ...row, rig: { ...row.rig, name: next.rig.name } });
      await finished;
      return result;
    },
    async duplicate(id, now) {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const finished = done(tx);
      const row: unknown = await request(store.get(id));
      const entry = row === undefined ? undefined : readRecord(row);
      let made: string | undefined;
      if (entry?.kind === "ok") {
        const keys = await request(store.getAllKeys());
        const copy = variantOf(entry.record, new Set(keys.map(String)), now);
        store.put(copy);
        made = copy.id;
      }
      await finished;
      return made;
    },
    async remove(id) {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const finished = done(tx);
      const row: unknown = await request(store.get(id));
      let result: RemoveResult = "deleted";
      if (row === undefined) result = "missing";
      else if (isRecord(row) && row.seeded === true) result = "refused";
      else store.delete(id);
      await finished;
      return result;
    },
    async seededIds() {
      return readSeedLedger(await request(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(SEED_KEY)));
    },
    async writeSeededIds(ids) {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(ledgerOf(ids));
      await done(tx);
    },
  };
}

/**
 * The library: IndexedDB when it opens, otherwise the in-memory twin (check `persistent` to show
 * the notice). `factory` gives the browser's `indexedDB` by default; reading that global can
 * itself throw in some private modes, which also means memory.
 */
export async function openLibrary(factory: () => IDBFactory | undefined = () => globalThis.indexedDB): Promise<LibraryStore> {
  let idb: IDBFactory | undefined;
  try {
    idb = factory();
  } catch {
    idb = undefined;
  }
  if (idb === undefined) return memoryLibrary();
  try {
    return idbLibrary(await openDb(idb));
  } catch {
    return memoryLibrary();
  }
}
