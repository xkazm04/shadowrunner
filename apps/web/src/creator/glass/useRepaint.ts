// forge-creator S2, repaint one face: the Face tab's Repaint, one family at a time.
// asking (the editable eyes line and the "too subtle" chip, the estimate shown before spending)
// -> painting (one paid edit, a calm status) -> candidate (beside the current face: Show current /
// Show candidate on the glass, Accept / Decline) or refused (the gate's reading; nothing to accept)
// or failed (the error; `expired` when the source job is gone).
// - The candidate's files are fetched once, for the preview, and those Blobs are what Accept keeps:
//   only the new files are fetched, nothing of the record is re-fetched.
// - Accept saves `acceptRepaint(record, candidate, blobs, look)` through the library's `add` (the
//   look on screen, so an unsaved look edit is kept); Decline and Cancel make no call at all.
// - The record's window (`repaintWindow`) gates the whole thing: no source, no Repaint.
import type { RigAssets } from "@sr/avatar";
import type { ExpressionFamily, Look, Rig } from "@sr/rig";
import type { RepaintCandidate } from "@sr/forge/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { acceptRepaint, candidateFiles } from "../forge/repaint";
import { repaintFace, repaintKey, RepaintError } from "../forge/repaintClient";
import { rigAssetsOf, urlsToBlobs } from "../library/assets";
import type { CharacterRecord } from "../library/libraryStore";
import { withRepaint } from "../forge/faces";

export type RepaintState =
  | { step: "idle" }
  | { step: "asking"; family: ExpressionFamily; eyes: string; subtle: boolean }
  | { step: "painting"; family: ExpressionFamily }
  | { step: "candidate"; family: ExpressionFamily; candidate: RepaintCandidate; blobs: Record<string, Blob>; preview: { rig: Rig; assets?: RigAssets }; shown: "current" | "candidate" }
  | { step: "refused"; family: ExpressionFamily; candidate: RepaintCandidate }
  | { step: "failed"; family: ExpressionFamily; message: string; expired: boolean };

export interface RepaintDeps {
  repaint?: typeof repaintFace;
  fetchBlobs?: typeof urlsToBlobs;
  decode?: typeof rigAssetsOf;
}

export interface Repaint {
  state: RepaintState;
  open(family: ExpressionFamily): void;
  setEyes(eyes: string): void;
  setSubtle(subtle: boolean): void;
  cancel(): void;
  paint(): void;
  show(which: "current" | "candidate"): void;
  accept(): Promise<void>;
  decline(): void;
}

export function useRepaint(record: CharacterRecord, look: Look, add: (record: CharacterRecord) => Promise<void>, deps: RepaintDeps = {}): Repaint {
  const [state, setState] = useState<RepaintState>({ step: "idle" });
  const { repaint = repaintFace, fetchBlobs = urlsToBlobs, decode = rigAssetsOf } = deps;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const set = useCallback((next: RepaintState): void => {
    if (live.current) setState(next);
  }, []);

  const open = useCallback((family: ExpressionFamily) => setState({ step: "asking", family, eyes: record.source?.eyes ?? "", subtle: false }), [record.source?.eyes]);
  const setEyes = useCallback((eyes: string) => setState((s) => (s.step === "asking" ? { ...s, eyes } : s)), []);
  const setSubtle = useCallback((subtle: boolean) => setState((s) => (s.step === "asking" ? { ...s, subtle } : s)), []);
  const cancel = useCallback(() => setState({ step: "idle" }), []);

  const paint = useCallback(() => {
    const source = record.source;
    if (state.step !== "asking" || source === undefined) return;
    const { family, eyes, subtle } = state;
    setState({ step: "painting", family });
    const line = eyes.replace(/\s+/g, " ").trim();
    void (async () => {
      try {
        const candidate = await repaint(source.jobId, { family, key: repaintKey(), ...(line === "" ? {} : { eyes: line }), ...(subtle ? { hint: "too_subtle" as const } : {}) });
        if (!candidate.ok || candidate.patch === undefined) return set({ step: "refused", family, candidate });
        const rig = withRepaint(record.rig, family, candidate.patch.layers);
        if (rig === undefined) return set({ step: "failed", family, message: "The new face does not fit this character.", expired: false });
        const urls = Object.fromEntries(candidateFiles(candidate).flatMap((f) => (candidate.patch?.assets[f] === undefined ? [] : [[f, candidate.patch.assets[f]] as const])));
        const blobs = await fetchBlobs(urls);
        const preview: { rig: Rig; assets?: RigAssets } = { rig };
        try {
          preview.assets = await decode(rig, { ...record.assets, ...blobs });
        } catch {
          // The candidate is still shown as words; the glass keeps the current face.
        }
        set({ step: "candidate", family, candidate, blobs, preview, shown: "candidate" });
      } catch (err) {
        const expired = err instanceof RepaintError && err.expired;
        set({ step: "failed", family, message: err instanceof Error ? err.message : "The repaint failed.", expired });
      }
    })();
  }, [state, record, repaint, fetchBlobs, decode, set]);

  const show = useCallback((which: "current" | "candidate") => setState((s) => (s.step === "candidate" ? { ...s, shown: which } : s)), []);
  const decline = useCallback(() => setState({ step: "idle" }), []);
  const accept = useCallback(async () => {
    if (state.step !== "candidate") return;
    const next = acceptRepaint(record, state.candidate, state.blobs, look);
    if (next === undefined) return set({ step: "failed", family: state.family, message: "The new face could not be kept.", expired: false });
    await add(next);
    set({ step: "idle" });
  }, [state, record, look, add, set]);

  return { state, open, setEyes, setSubtle, cancel, paint, show, accept, decline };
}
