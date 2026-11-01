// The replay gallery's characters (creator requirement 4).
//
// Decision (spec gap): requirement 4.1 names `assets/replay/characters/*/rig.json`; that folder does
// not exist. The gallery is derived instead from the recorded forge jobs
// (`assets/replay/forge/<slug>/job.json`, the same jobs the replay plane serves, read through
// `loadReplayJobs`) plus Malakor from `assets/characters/malakor/`. No rig is invented: each entry
// is a committed rig, and only fictional rigs are listed. New jobs dropped into the forge folder
// appear here without a code change.
import type { Rig } from "@sr/rig";
import { recordOf } from "../forge/keep";
import type { CharacterRecord } from "../library/libraryStore";
import { loadMalakor, malakorFiles, malakorRig } from "../library/seed";
import { loadReplayJobs, type ReplayJob } from "../replayJobs";

export interface GalleryEntry {
  /** The rig id: the library record it becomes. */
  id: string;
  name: string;
  /** A picture of the character (its source portrait). */
  portraitUrl?: string;
  /** What it was forged from, when recorded. */
  prompt?: string;
  layers: number;
  /** How the rig was made: cut by the forge, or rigged by hand (Malakor). */
  origin: "forged" | "hand-rigged";
  /** Builds the library record (fetches the layer images). */
  load(): Promise<CharacterRecord>;
}

export function entryOfJob(job: ReplayJob): GalleryEntry {
  const entry: GalleryEntry = {
    id: job.rig.id,
    name: job.rig.name,
    portraitUrl: job.portraitUrl,
    layers: job.rig.layers.length,
    origin: "forged",
    load: () => recordOf(job.rig, job.assets),
  };
  if (job.prompt !== undefined) entry.prompt = job.prompt;
  return entry;
}

function malakorEntry(): GalleryEntry | undefined {
  let rig: Rig;
  try {
    rig = malakorRig();
  } catch {
    return undefined;
  }
  const portraitUrl = malakorFiles()["portrait.png"];
  const entry: GalleryEntry = {
    id: rig.id,
    name: rig.name,
    prompt: "The house character: a lich auditor in a crown of floating shards, hand-rigged.",
    layers: rig.layers.length,
    origin: "hand-rigged",
    load: () => loadMalakor(),
  };
  if (portraitUrl !== undefined) entry.portraitUrl = portraitUrl;
  return entry;
}

/** Malakor first, then every recorded job's rig that is fictional, by name. */
export async function loadGallery(jobs: () => Promise<readonly ReplayJob[]> = loadReplayJobs): Promise<GalleryEntry[]> {
  const recorded = (await jobs())
    .filter((job) => job.rig.fictional === true)
    .map(entryOfJob)
    .sort((a, b) => a.name.localeCompare(b.name));
  const malakor = malakorEntry();
  return malakor === undefined ? recorded : [malakor, ...recorded];
}
