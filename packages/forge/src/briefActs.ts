// Signature acts from the brief's words (tiger L1, docs/rig-format.md "Act"). A part's motion words
// often name an event ("floats, points, 'sold' slam", "swings and thunks when something is
// approved"); `motionFromWords` drops those clauses because the rig's motion is periodic. Here
// they become a `Layer.act`: the part's own motion played once when a spoken line says the cue
// word. A small, honest heuristic, pure and browser-safe (the creator and the stage import it as
// "@sr/forge/acts"):
// - a quoted word ("on 'sold'", "a \"ring\"") is a cue, each one;
// - else the first content word after "when" / "whenever" / "each time" / "every time" /
//   "as soon as" is ("when ringing" -> ring, "when a vow is kept" -> vow, "when something is
//   approved" -> approved); an -ing word is cut to its stem;
// - "on <thing>" without quotes ("brightens on open", "twitches on emphasis") and "toward the
//   speaker" (gaze) are not acts.
// Only a lifted part that may carry one: float, pulse, accessory, crown, hat, monocle roles; never
// head, torso, jaw, eyes or hair.
import { ACT_CUE_CHARS, ACT_CUE_MAX, type LayerAct } from "@sr/rig";
import { expandPartName, recordedRole } from "./brief.js";
import { PART_ROLES } from "./parts.js";
import type { PartRole } from "./types.js";

export const ACT_ROLES: readonly PartRole[] = ["float", "pulse", "accessory", "crown", "hat", "monocle"];

const QUOTED = /(?:^|[\s(/])['"‘“]([a-z][a-z0-9-]*)['"’”]/g;
const EVENT = /\b(?:whenever|when|each time|every time|as soon as)\s+(.+)$/;
const STOP = new Set(
  "a an the it its it's is are was were be been being gets get got goes go something someone somebody anything anyone anybody everything everyone there this that these those one some any every new his her their our my your on of to in at by for with who whoever what whatever he she they them we you i".split(" "),
);
const CUE_WORD = /^[a-z][a-z0-9'-]*$/;

/** "ringing" -> "ring", "counting" -> "count", "running" -> "run"; other words as they are. */
export function stemCue(word: string): string {
  if (!word.endsWith("ing") || word.length < 6) return word;
  const stem = word.slice(0, -3);
  const last = stem.at(-1);
  return last !== undefined && stem.at(-2) === last && !"lsz".includes(last) ? stem.slice(0, -1) : stem;
}

const usable = (word: string): boolean => word.length >= 3 && word.length <= ACT_CUE_CHARS && CUE_WORD.test(word);

/** The cue words in one clause: its quoted words, else the event's first content word. */
function cuesOf(clause: string): string[] {
  const quoted = [...clause.matchAll(QUOTED)].map((m) => m[1] ?? "").filter(usable);
  if (quoted.length > 0) return quoted;
  const event = EVENT.exec(clause)?.[1];
  if (event === undefined) return [];
  const word = event.split(/[^a-z'-]+/).find((w) => w !== "" && !STOP.has(w));
  const cue = word === undefined ? undefined : stemCue(word.replace(/'s$/, ""));
  return cue !== undefined && usable(cue) ? [cue] : [];
}

/**
 * The part's signature act from its brief motion words, or undefined when its role may not carry
 * one or its words name no event. `gain` and `s` are left to the defaults.
 */
export function actFromWords(name: string, role: PartRole, words: string | undefined): LayerAct | undefined {
  if (words === undefined || name === "" || !ACT_ROLES.includes(role)) return undefined;
  const cue: string[] = [];
  for (const clause of words.toLowerCase().split(/[;,.!?]/)) {
    for (const word of cuesOf(clause)) if (!cue.includes(word) && cue.length < ACT_CUE_MAX) cue.push(word);
  }
  return cue.length === 0 ? undefined : { cue };
}

/** One part of a brief: its name, role and motion words. */
interface PartWords {
  name: string;
  role: PartRole;
  motion?: string;
}

/** Per part name, its act: every part of the brief that has one. */
export function actsFromParts(parts: readonly PartWords[]): Map<string, LayerAct> {
  const out = new Map<string, LayerAct>();
  for (const part of parts) {
    const act = actFromWords(part.name, part.role, part.motion);
    if (act !== undefined) out.set(part.name, act);
  }
  return out;
}

/** "hand_r: on \"sold\"" - the act as one read-only line for the brief card. */
export function actLine(name: string, act: LayerAct): string {
  return `${name}: on ${act.cue.map((w) => `"${w}"`).join(" or ")}`;
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isRole = (v: unknown): v is PartRole => PART_ROLES.some((r) => r === v);

/**
 * The acts of a recorded contest brief's `parts` (assets/characters/cast/<slug>/brief.json), read
 * the way `briefFromRecorded` reads them (`kind` -> role, range names expanded); anything that does
 * not read is skipped. The stage compiles the recorded cast's acts with it at load time, so the
 * recorded jobs stay byte-identical.
 */
export function actsFromRecordedParts(parts: unknown): Map<string, LayerAct> {
  if (!Array.isArray(parts)) return new Map();
  const words = parts.flatMap((p: unknown): PartWords[] => {
    if (!isRecord(p) || typeof p.name !== "string") return [];
    const motion = typeof p.motion === "string" ? p.motion : undefined;
    return expandPartName(p.name).flatMap((name) => {
      const role = recordedRole(p.kind ?? p.role, name);
      return isRole(role) ? [{ name, role, ...(motion === undefined ? {} : { motion }) }] : [];
    });
  });
  return actsFromParts(words);
}
