// The replay gallery's characters (creator requirement 4) and the cast seeded into every library
// (creator task 9), also listed on CH 4 (landing task 12).
//
// Decision (spec gap): requirement 4.1 names `assets/replay/characters/*/rig.json`; that folder does
// not exist. The gallery is derived instead from the recorded forge jobs
// (`assets/replay/forge/<slug>/job.json`, the same jobs the replay plane serves, read through
// `loadReplayJobs`) plus Malakor from `assets/characters/malakor/`. No rig is invented: each entry
// is a committed rig, and only fictional rigs are listed. New jobs dropped into the forge folder
// appear here without a code change. What a character teaches and who it is come from the preset
// notes (`notes.ts`), the layer kinds it shows off from its own rig.
import type { LayerKind, Rig } from "@sr/rig";
import { recordOf } from "../forge/keep";
import type { CharacterRecord } from "../library/libraryStore";
import { loadMalakor, MALAKOR_ID, malakorFiles, malakorRig } from "../library/seed";
import { loadReplayJobs, thumbOf, type ReplayJob } from "../replayJobs";
import { castBriefNote } from "./castBriefs";
import { noteFor, presetNotes, type PresetNotes } from "./notes";

export interface GalleryEntry {
  /** The rig id: the library record it becomes. */
  id: string;
  /** The address of the character in links (`/creator?character=<slug>`): the job's folder name. */
  slug: string;
  name: string;
  /** A picture of the character: a small still when one is committed, else its source portrait. */
  portraitUrl?: string;
  /** What it was forged from, when recorded. */
  prompt?: string;
  layers: number;
  /** The animated layer kinds in its rig, in a fixed order (crown, accessory, jaw, eye). */
  kinds: LayerKind[];
  /** From the notes: the part of the rig it was made to show off ("hat, lit jaw"). */
  showsOff?: string;
  /** From the notes: what it teaches about the rig. */
  teaches?: string;
  /** From the notes: one line about who it is. */
  hook?: string;
  /** How the rig was made: cut by the forge, or rigged by hand (Malakor). */
  origin: "forged" | "hand-rigged";
  /**
   * A cast-forge character (castBriefs.ts): listed and adopted on demand (a gallery press or a deep
   * link), not seeded into every library in the background.
   */
  onDemand?: true;
  /** Builds the library record (fetches the layer images). */
  load(): Promise<CharacterRecord>;
}

const SHOWN_KINDS: readonly LayerKind[] = ["crown", "accessory", "jaw", "eye"];

/** The animated kinds a rig has, in SHOWN_KINDS order. */
export function kindsOf(rig: Rig): LayerKind[] {
  const present = new Set(rig.layers.map((l) => l.kind));
  return SHOWN_KINDS.filter((k) => present.has(k));
}

function withNotes(entry: GalleryEntry, notes: PresetNotes): GalleryEntry {
  const note = noteFor(notes, entry.name, entry.prompt);
  return { ...entry, ...note };
}

export function entryOfJob(job: ReplayJob, notes: PresetNotes = presetNotes()): GalleryEntry {
  const entry: GalleryEntry = {
    id: job.rig.id,
    slug: job.slug,
    name: job.rig.name,
    portraitUrl: job.thumbUrl ?? job.portraitUrl,
    layers: job.rig.layers.length,
    kinds: kindsOf(job.rig),
    origin: "forged",
    load: () => recordOf(job.rig, job.assets),
  };
  if (job.prompt !== undefined) entry.prompt = job.prompt;
  // A cast-forge character speaks from its own brief: its hook, and the style it shows off.
  const brief = castBriefNote(job.slug);
  if (brief !== undefined) return { ...entry, hook: brief.hook, showsOff: brief.style, onDemand: true };
  return withNotes(entry, notes);
}

function malakorEntry(notes: PresetNotes): GalleryEntry | undefined {
  let rig: Rig;
  try {
    rig = malakorRig();
  } catch {
    return undefined;
  }
  const portraitUrl = thumbOf(MALAKOR_ID) ?? malakorFiles()["portrait.png"];
  const entry: GalleryEntry = {
    id: rig.id,
    slug: MALAKOR_ID,
    name: rig.name,
    prompt: "The house character: a lich auditor in a crown of floating shards, hand-rigged.",
    layers: rig.layers.length,
    kinds: kindsOf(rig),
    origin: "hand-rigged",
    load: () => loadMalakor(),
  };
  if (portraitUrl !== undefined) entry.portraitUrl = portraitUrl;
  // His notes are the roster row only; the prompt above is a label, not a forge prompt.
  const { showsOff } = noteFor(notes, rig.name);
  return showsOff === undefined ? entry : { ...entry, showsOff };
}

/** Sort key: the name without a leading "The". */
const sortName = (name: string): string => name.replace(/^the\s+/i, "").toLowerCase();

/** Malakor first, then every recorded job's rig that is fictional, by name. */
export async function loadGallery(
  jobs: () => Promise<readonly ReplayJob[]> = loadReplayJobs,
  notes: PresetNotes = presetNotes(),
): Promise<GalleryEntry[]> {
  const recorded = (await jobs())
    .filter((job) => job.rig.fictional === true)
    .map((job) => entryOfJob(job, notes))
    .sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
  const malakor = malakorEntry(notes);
  return malakor === undefined ? recorded : [malakor, ...recorded];
}

/**
 * The cast: every gallery character once. A recorded job that re-forges a hand-rigged character
 * (the `malakor` job) stays in the gallery but not in the cast, where the house rig stands for it.
 */
export function castOf(entries: readonly GalleryEntry[]): GalleryEntry[] {
  const hand = new Set(entries.filter((e) => e.origin === "hand-rigged").map((e) => e.slug));
  return entries.filter((e) => e.origin === "hand-rigged" || !hand.has(e.slug));
}

/** Malakor and then the recorded presets, as `castOf(loadGallery())`. */
export async function loadCast(jobs?: () => Promise<readonly ReplayJob[]>, notes?: PresetNotes): Promise<GalleryEntry[]> {
  return castOf(await loadGallery(jobs, notes));
}

/** The cast member a deep link names, by slug or by rig id. */
export function memberFor<T extends { id: string; slug: string }>(cast: readonly T[], wanted: string): T | undefined {
  return cast.find((m) => m.slug === wanted) ?? cast.find((m) => m.id === wanted);
}
