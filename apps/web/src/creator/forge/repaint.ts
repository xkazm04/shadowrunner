// forge-creator S2, repaint one face: the record-level rules of the Face tab's Repaint. Pure, no DOM.
// - `repaintWindow(record, now)`: "none" (recorded, replay or imported: no source), "open" or
//   "expired" (the source job's 24 h are over).
// - `acceptRepaint(record, candidate, blobs, look)`: the record after Accept, or undefined when the
//   candidate cannot be accepted (it did not pass the gate, it is a recorded face, its files were not
//   all fetched, or `withRepaint` refuses it). Only `family`'s patches change (faces.ts withRepaint);
//   the assets gain exactly the candidate's files and drop the replaced face's files; the family's
//   gate reading goes (it is painted now); look (the one on screen), voice, sheet and source stay.
// - Decline is no call at all: the record is left as it is, byte for byte.
import type { FaceGate } from "@sr/forge/faceGate";
import type { RepaintCandidate } from "@sr/forge/wire";
import type { Look } from "@sr/rig";
import { rigFiles } from "../library/assets";
import type { CharacterRecord } from "../library/libraryStore";
import { withRepaint } from "./faces";

export type RepaintWindow = "none" | "open" | "expired";

export function repaintWindow(record: Pick<CharacterRecord, "source">, now: number): RepaintWindow {
  if (record.source === undefined) return "none";
  return now < record.source.expiresAt ? "open" : "expired";
}

/** The candidate's files (patch images and sockets): the only ones a client fetches. */
export function candidateFiles(candidate: RepaintCandidate): string[] {
  return Object.values(candidate.patch?.layers ?? {}).flatMap((p) => [p.file, ...(p.socket === undefined ? [] : [p.socket])]);
}

/** The record after Accept (see the header), or undefined when the candidate cannot be accepted. */
export function acceptRepaint(record: CharacterRecord, candidate: RepaintCandidate, blobs: Readonly<Record<string, Blob>>, look: Look = record.look): CharacterRecord | undefined {
  if (!candidate.ok || candidate.plane !== "live" || candidate.patch === undefined) return undefined;
  const files = candidateFiles(candidate);
  if (files.some((f) => blobs[f] === undefined)) return undefined;
  const rig = withRepaint(record.rig, candidate.family, candidate.patch.layers);
  if (rig === undefined) return undefined;
  const keep = new Set(rigFiles(rig));
  const assets: Record<string, Blob> = {};
  for (const [file, blob] of Object.entries(record.assets)) if (keep.has(file)) assets[file] = blob;
  for (const file of files) assets[file] = blobs[file] as Blob;
  const next: CharacterRecord = { ...record, rig, assets, look };
  delete next.faceGate;
  const gate: FaceGate = Object.fromEntries(Object.entries(record.faceGate ?? {}).filter(([f]) => f !== candidate.family));
  return Object.keys(gate).length === 0 ? next : { ...next, faceGate: gate };
}
