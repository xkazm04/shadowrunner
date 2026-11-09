// The library as React state: opens the store (IndexedDB or memory), seeds the cast (creator task 9:
// Malakor, or the character a deep link asks for, before the first paint; the rest of the cast in
// the background, the strip filling as each arrives; an on-demand member, a cast-forge character,
// only when a deep link asks for it), lists the entries, tracks the active
// character and decodes its layer images for the stage.
// perfection-pass task 7: `rename` (rig.name; refused for the house character) and `duplicate` (a
// variant under a new id, made active), both through the store (library/variant.ts).
import type { RigAssets } from "@sr/avatar";
import type { VoiceId } from "@sr/engine";
import type { Look, Rig } from "@sr/rig";
import { useCallback, useEffect, useRef, useState } from "react";
import { rigAssetsOf } from "./assets";
import { openLibrary, type CharacterRecord, type LibraryEntry, type LibraryStore, type RemoveResult, type RenameResult } from "./libraryStore";
import { loadCast, memberFor } from "../gallery/entries";
import { seedCast, type CastSeed } from "./seed";
import { cleanName, sameArt } from "./variant";

const ACTIVE_KEY = "sr-creator-active";

function readActive(): string | undefined {
  try {
    return window.localStorage.getItem(ACTIVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeActive(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // A per-viewer convenience only.
  }
}

export interface Library {
  status: "loading" | "ready" | "failed";
  persistent: boolean;
  entries: LibraryEntry[];
  /** The active character, when there is one that reads. */
  active?: CharacterRecord;
  select(id: string): void;
  /** Stores a whole record (forged or adopted) and makes it active. */
  add(record: CharacterRecord): Promise<void>;
  remove(id: string): Promise<RemoveResult>;
  saveLook(id: string, look: Look): Promise<void>;
  saveVoice(id: string, voice: VoiceId): Promise<void>;
  /** Sets the character's name (rig.name). */
  rename(id: string, name: string): Promise<RenameResult>;
  /** Stores a variant of the character and makes it active; its new id. Rejects when there is no readable record. */
  duplicate(id: string): Promise<string>;
}

const okRecords = (entries: readonly LibraryEntry[]): CharacterRecord[] => entries.flatMap((e) => (e.kind === "ok" ? [e.record] : []));

/** A cast member as the library seeds it: the house character first. */
export interface CastMember extends CastSeed {
  slug: string;
  /** Seeded only when a deep link asks for it, never in the background pass (gallery entries.ts). */
  onDemand?: true;
}

export interface UseLibraryOptions {
  open?: () => Promise<LibraryStore>;
  /** The cast to seed, house character first. Default: the gallery's cast. */
  cast?: () => Promise<readonly CastMember[]>;
  /** The character a deep link asks for (`/creator?character=<slug>`): a cast slug or a record id. */
  want?: string;
}

/** The `character` parameter of a query string, when present. */
export function wantedCharacter(search: string): string | undefined {
  const value = new URLSearchParams(search).get("character")?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function useLibrary({ open = () => openLibrary(), cast = loadCast, want }: UseLibraryOptions = {}): Library {
  const store = useRef<LibraryStore | undefined>(undefined);
  const [status, setStatus] = useState<Library["status"]>("loading");
  const [persistent, setPersistent] = useState(true);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await open();
        // A cast that cannot load (offline art) leaves the library as it is, not a broken page.
        const members = await cast().catch((): CastMember[] => []);
        const target = want === undefined ? undefined : memberFor(members, want);
        const first = new Set([members[0]?.id, target?.id].filter((id): id is string => id !== undefined));
        const clock = new Date();
        const now = (): Date => clock;
        await seedCast(s, members, { now, only: first }).catch(() => undefined);
        const list = await s.list();
        if (!live) return;
        store.current = s;
        setPersistent(s.persistent);
        setEntries(list);
        const records = okRecords(list);
        const has = (id: string | undefined): id is string => id !== undefined && records.some((r) => r.id === id);
        const wanted = target?.id ?? want;
        const pick = has(wanted) ? wanted : [readActive(), records[0]?.id].find(has);
        if (pick !== undefined && pick === wanted) writeActive(pick);
        setActiveId(pick);
        setStatus("ready");
        // The rest of the cast, in the background; on-demand members wait for a press or a link.
        const background = new Set(members.filter((m) => m.onDemand !== true).map((m) => m.id));
        await seedCast(s, members, {
          now,
          only: background,
          onAdded: () => {
            void s.list().then((next) => live && setEntries(next));
          },
        }).catch(() => undefined);
      } catch {
        if (live) setStatus("failed");
      }
    })();
    return () => {
      live = false;
    };
    // Opened once per mount: `open`, `cast` and `want` are read at mount only.
  }, []);

  const refresh = useCallback(async () => {
    if (store.current !== undefined) setEntries(await store.current.list());
  }, []);

  const select = useCallback((id: string) => {
    setActiveId(id);
    writeActive(id);
  }, []);

  const patchLocal = useCallback((id: string, patch: Partial<CharacterRecord>) => {
    setEntries((list) => list.map((e) => (e.kind === "ok" && e.record.id === id ? { kind: "ok", record: { ...e.record, ...patch } } : e)));
  }, []);

  const active = okRecords(entries).find((r) => r.id === activeId);

  return {
    status,
    persistent,
    entries,
    ...(active === undefined ? {} : { active }),
    select,
    add: async (record) => {
      await store.current?.put(record);
      await refresh();
      select(record.id);
    },
    remove: async (id) => {
      const result = (await store.current?.remove(id)) ?? "missing";
      if (result === "deleted") {
        const list = (await store.current?.list()) ?? [];
        setEntries(list);
        if (id === activeId) {
          const next = okRecords(list)[0]?.id;
          if (next !== undefined) select(next);
        }
      }
      return result;
    },
    saveLook: async (id, look) => {
      patchLocal(id, { look });
      await store.current?.saveLook(id, look);
    },
    saveVoice: async (id, voice) => {
      patchLocal(id, { voice });
      await store.current?.saveVoice(id, voice);
    },
    rename: async (id, name) => {
      const result = (await store.current?.rename(id, name)) ?? "missing";
      // Patched in place (images and look keep their identity), so the stage does not decode again.
      const kept = cleanName(name);
      if (result === "renamed" && kept !== undefined) {
        setEntries((list) => list.map((e) => (e.kind === "ok" && e.record.id === id ? { kind: "ok", record: { ...e.record, rig: { ...e.record.rig, name: kept } } } : e)));
      }
      return result;
    },
    duplicate: async (id) => {
      const made = await store.current?.duplicate(id);
      if (made === undefined) throw new Error("There is no character to duplicate.");
      await refresh();
      select(made);
      return made;
    },
  };
}

/**
 * `rig`, but the same object as before while only its name changed (a rename), so nothing that
 * keys on the rig (decoding, the renderer's setRig) runs again for a new name.
 */
export function useArtRig<R extends Rig | undefined>(rig: R): R {
  const [held, setHeld] = useState<R>(rig);
  const keep = held !== rig && held !== undefined && rig !== undefined && sameArt(held, rig);
  if (held !== rig && !keep) setHeld(rig);
  return keep ? held : rig;
}

/** The active record's layer images, decoded for the renderer; undefined while decoding or on failure. */
export function useRigAssets(record: CharacterRecord | undefined): { assets?: RigAssets; failed: boolean } {
  const [state, setState] = useState<{ id?: string; assets?: RigAssets; failed: boolean }>({ failed: false });
  const rig = useArtRig(record?.rig);
  const blobs = record?.assets;
  useEffect(() => {
    if (rig === undefined || blobs === undefined) return undefined;
    let live = true;
    setState({ failed: false });
    rigAssetsOf(rig, blobs).then(
      (assets) => live && setState({ id: rig.id, assets, failed: false }),
      () => live && setState({ id: rig.id, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [rig, blobs]);
  if (record === undefined || state.id !== record.id) return { failed: false };
  return state.assets === undefined ? { failed: state.failed } : { assets: state.assets, failed: state.failed };
}
