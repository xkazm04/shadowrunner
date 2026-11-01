// The library as React state: opens the store (IndexedDB or memory), seeds Malakor when empty,
// lists the entries, tracks the active character and decodes its layer images for the stage.
import type { RigAssets } from "@sr/avatar";
import type { VoiceId } from "@sr/engine";
import type { Look } from "@sr/rig";
import { useCallback, useEffect, useRef, useState } from "react";
import { rigAssetsOf } from "./assets";
import { openLibrary, type CharacterRecord, type LibraryEntry, type LibraryStore, type RemoveResult } from "./libraryStore";
import { seedIfEmpty } from "./seed";

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
}

const okRecords = (entries: readonly LibraryEntry[]): CharacterRecord[] => entries.flatMap((e) => (e.kind === "ok" ? [e.record] : []));

export interface UseLibraryOptions {
  open?: () => Promise<LibraryStore>;
  seed?: (store: LibraryStore) => Promise<unknown>;
}

export function useLibrary({ open = () => openLibrary(), seed = seedIfEmpty }: UseLibraryOptions = {}): Library {
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
        await seed(s);
        const list = await s.list();
        if (!live) return;
        store.current = s;
        setPersistent(s.persistent);
        setEntries(list);
        const remembered = readActive();
        const records = okRecords(list);
        setActiveId(records.some((r) => r.id === remembered) ? remembered : records[0]?.id);
        setStatus("ready");
      } catch {
        if (live) setStatus("failed");
      }
    })();
    return () => {
      live = false;
    };
    // Opened once per mount: `open` and `seed` are read at mount only.
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
  };
}

/** The active record's layer images, decoded for the renderer; undefined while decoding or on failure. */
export function useRigAssets(record: CharacterRecord | undefined): { assets?: RigAssets; failed: boolean } {
  const [state, setState] = useState<{ id?: string; assets?: RigAssets; failed: boolean }>({ failed: false });
  const rig = record?.rig;
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
