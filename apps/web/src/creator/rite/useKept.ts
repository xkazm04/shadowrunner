// The rite's kept character (creator requirement 3.3; forge-creator C1, wake after eyes): the forge
// job's character goes into the library once, as soon as the job is awake (an `expressing` view
// with the final rig) or done, bound as the visitor chose, and is the face the glass wakes.
// Faces that arrive later fold into that record:
// - Only through `mergeFaces` (faces.ts): a later rig that is not an additive extension of the one
//   kept is ignored, and the awake character stays.
// - Only the rig and the assets change. The record's look and voice are the visitor's (edits made
//   since Wake survive), the name the brief's; only files the kept rig did not name are fetched; the
//   record is saved through the library's own `add`.
// - Merges run one at a time, each from the latest kept record, so a look edit during a fetch is kept.
// - The glass shows a rig only with the images decoded for that rig (`shown`), so a merge never
//   flashes the glass empty or pairs a new rig with old images.
// - forge-creator S1: the job's gate readings (why a family has no painted face) ride on the record
//   as `faceGate`, written at keep and again whenever the job reports new ones, through the same
//   one-at-a-time chain, so the Face tab can say why after a reload. A replay job has none.
// - forge-creator S2: a live job's character is kept with its `source` (job id, end of life, the
//   brief's eyes line), so the Face tab can repaint one face within the job's 24 h. Replay has none.
import type { RigAssets } from "@sr/avatar";
import type { FaceGate } from "@sr/forge/faceGate";
import type { CharacterBrief } from "@sr/forge/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { lookReducer, type LookAction } from "../customize/lookReducer";
import { mergeFaces, newFiles, type Woken } from "../forge/faces";
import type { ForgeState } from "../forge/forgeReducer";
import { recordOf, withBrief } from "../forge/keep";
import { rigAssetsOf, urlsToBlobs } from "../library/assets";
import type { CharacterRecord, CharacterSource } from "../library/libraryStore";
import type { Library } from "../library/useLibrary";
import { bound, type Bind } from "./request";

/** The forge job's character, once it has one: awake while running, or done. */
export function characterOf(state: ForgeState): { jobId: string; character: Woken } | undefined {
  if (state.phase === "done") return { jobId: state.jobId, character: { rig: state.rig, assets: state.assets } };
  if (state.phase === "running" && state.awake !== undefined) return { jobId: state.jobId, character: state.awake };
  return undefined;
}

/** The job's gate readings so far (S1), if any. */
export function gateOf(state: ForgeState): FaceGate | undefined {
  return state.phase === "running" || state.phase === "done" ? state.gate : undefined;
}

/**
 * S2: where a live job's character can still have one face repainted (its job id and end of life)
 * with the brief's eyes line; undefined on replay (no `expiresAt`) and before the job is known.
 */
export function sourceOf(state: ForgeState, brief: CharacterBrief | undefined): CharacterSource | undefined {
  if ((state.phase !== "running" && state.phase !== "done") || state.expiresAt === undefined) return undefined;
  const eyes = brief?.face?.eyes;
  return { jobId: state.jobId, expiresAt: state.expiresAt, ...(eyes === undefined ? {} : { eyes }) };
}

/** `record` carrying `source` (or as it is, when there is none). */
export const withSource = (record: CharacterRecord, source: CharacterSource | undefined): CharacterRecord => (source === undefined ? record : { ...record, source });

/** `record` carrying `gate` (or as it is, when there is none). */
export const withGate = (record: CharacterRecord, gate: FaceGate | undefined): CharacterRecord => (gate === undefined ? record : { ...record, faceGate: gate });

export interface Kept {
  kept?: CharacterRecord;
  /** The rig on the glass with its decoded images (lags `kept` while a merge decodes). */
  shown?: { rig: CharacterRecord["rig"]; assets: RigAssets };
  keepError?: string;
  /** Forget the kept character (a new job, back to the form). */
  clear(): void;
  /** A look edit on the kept character, saved. */
  dress(action: LookAction): void;
}

export function useKept(state: ForgeState, library: Pick<Library, "status" | "add" | "saveLook">, bind: Bind, drawn: { current: CharacterBrief | undefined }): Kept {
  const [kept, setKeptState] = useState<CharacterRecord | undefined>(undefined);
  const [keepError, setKeepError] = useState<string | undefined>(undefined);
  const [shown, setShown] = useState<{ id: string; rig: CharacterRecord["rig"]; assets: RigAssets } | undefined>(undefined);
  const keptRef = useRef<CharacterRecord | undefined>(undefined);
  const setKept = useCallback((record: CharacterRecord | undefined) => {
    keptRef.current = record;
    setKeptState(record);
  }, []);
  const keptFor = useRef<string | undefined>(undefined);
  /** The server's character as last folded into the record (before naming and binding). */
  const base = useRef<Woken | undefined>(undefined);
  const merging = useRef<Promise<void>>(Promise.resolve());
  const now = characterOf(state);
  const latest = useRef(now);
  const gate = gateOf(state);
  const latestGate = useRef(gate);
  const latestSource = useRef(sourceOf(state, drawn.current));
  useEffect(() => {
    latest.current = now;
    latestGate.current = gate;
    latestSource.current = sourceOf(state, drawn.current);
  });
  const { add, saveLook } = library;
  const ready = library.status === "ready";

  // Keep once per job, at awake (or done when the job never woke before it finished).
  useEffect(() => {
    if (now === undefined || keptFor.current === now.jobId || !ready) return;
    const { jobId, character } = now;
    keptFor.current = jobId;
    base.current = undefined;
    setKeepError(undefined);
    recordOf(character.rig, character.assets)
      .then(async (record) => {
        const named = drawn.current === undefined ? record : withBrief(record, drawn.current);
        const source = latestSource.current;
        const dressed = withSource(withGate(bound(named, bind), latestGate.current), source?.jobId === jobId ? source : undefined);
        await add(dressed);
        if (keptFor.current !== jobId) return;
        base.current = character;
        setKept(dressed);
      })
      .catch(() => setKeepError("The new face's images could not be kept. Forge again."));
  }, [now, ready, add, bind, drawn, setKept]);

  // Fold each later character into the kept record, one merge at a time.
  const rig = now?.character.rig;
  useEffect(() => {
    if (kept === undefined || rig === undefined || base.current === undefined || base.current.rig === rig) return;
    merging.current = merging.current.then(async () => {
      const from = base.current;
      const to = latest.current;
      const record = keptRef.current;
      if (from === undefined || to === undefined || record === undefined || to.jobId !== keptFor.current) return;
      const merged = mergeFaces(from, to.character);
      if (merged === from) return;
      try {
        const urls = Object.fromEntries(newFiles(from.rig, merged.rig).flatMap((f) => (merged.assets[f] === undefined ? [] : [[f, merged.assets[f]] as const])));
        const blobs = await urlsToBlobs(urls);
        const current = keptRef.current;
        if (current === undefined || current.id !== record.id || keptFor.current !== to.jobId) return;
        const next: CharacterRecord = { ...current, rig: { ...merged.rig, name: current.rig.name }, assets: { ...current.assets, ...blobs } };
        base.current = merged;
        setKept(next);
        await add(next);
      } catch {
        // A face that cannot be fetched stays procedural; the awake character is kept as it is.
      }
    });
  }, [kept, rig, add, setKept]);

  // S1: fold newer gate readings into the kept record, in the same chain as the faces.
  const gateKey = gate === undefined ? "" : JSON.stringify(gate);
  useEffect(() => {
    if (kept === undefined || gateKey === "" || gateKey === JSON.stringify(kept.faceGate ?? null)) return;
    merging.current = merging.current.then(async () => {
      const current = keptRef.current;
      const next = latestGate.current;
      if (current === undefined || next === undefined || keptFor.current !== latest.current?.jobId) return;
      if (JSON.stringify(next) === JSON.stringify(current.faceGate ?? null)) return;
      const record = withGate(current, next);
      setKept(record);
      try {
        await add(record);
      } catch {
        // The reading is a note: the kept character stands without it.
      }
    });
  }, [kept, gateKey, add, setKept]);

  // Decode the kept rig's images; the glass keeps the last decoded pair until the next is ready.
  const keptRig = kept?.rig;
  const keptBlobs = kept?.assets;
  const keptId = kept?.id;
  useEffect(() => {
    if (keptRig === undefined || keptBlobs === undefined || keptId === undefined) return undefined;
    let live = true;
    rigAssetsOf(keptRig, keptBlobs).then(
      (assets) => live && setShown({ id: keptId, rig: keptRig, assets }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [keptRig, keptBlobs, keptId]);

  const clear = useCallback(() => setKept(undefined), [setKept]);
  const dress = useCallback(
    (action: LookAction) => {
      const k = keptRef.current;
      if (k === undefined) return;
      const look = lookReducer(k.look, action);
      setKept({ ...k, look });
      void saveLook(k.id, look);
    },
    [saveLook, setKept],
  );

  return {
    ...(kept === undefined ? {} : { kept }),
    ...(kept !== undefined && shown !== undefined && shown.id === kept.id ? { shown: { rig: shown.rig, assets: shown.assets } } : {}),
    ...(keepError === undefined ? {} : { keepError }),
    clear,
    dress,
  };
}
