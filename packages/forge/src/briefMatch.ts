// perfection-pass task 8 (requirement 8): on the replay plane a new description is matched to the
// nearest recorded cast brief, so the brief the card shows (and the recorded job the forge then
// walks, chosen by that brief's one_line_request) follows the streamer's words instead of always
// being the first cast member. One pure function, used by the browser's replay brief client and by
// POST /api/forge/brief's replay branch, so both planes' replays answer alike.
//
// Decisions:
// - The score is a bag of words over the fields every recorded brief has: name (4), one_line_request
//   and archetype (3), part names and their words (2), silhouette, persona hook, style name, eyes
//   line, example lines and part motion (1). A request word scores its best field weight times
//   ln((N + 1) / df), df = how many of the N cast briefs hold it, so a word only one brief has
//   counts most. A word that more than half the cast holds ("head", "jaw", "chat") is common to the
//   cast, not a reason to choose, and does not count at all.
// - Normalisation is light and the same on both sides: lower case, letters only (digits and words
//   under three letters dropped), a stop-word list (English glue plus "spooky"-style house words
//   every request could say), British spellings folded, and a small stemmer: plurals
//   (-ies, -es after s/x/z/ch/sh, -s), then -ing / -ed when four letters stay. No embeddings, no
//   model, no network.
// - An exact one_line_request (case and spacing ignored) wins outright ("exact").
// - Ties: higher score, then more matched words, then the lower slug. Every input is ranked by
//   slug, never by its position, so the cast's order cannot change the answer.
// - Nothing matched ("none"): the pick is FNV-1a of the request key over the slugs in order, so
//   different requests spread over the cast instead of all landing on one character, and the card
//   says that nothing matched.
// - `matched` lists the request's own words (first spelling, request order) that counted, so the
//   card names what the streamer typed, not a stem.
import type { CharacterBrief } from "./wire.js";

/** What the matcher reads of a recorded brief; a CharacterBrief plus a slug is one. */
export type CastBriefSummary = Pick<CharacterBrief, "name" | "one_line_request" | "archetype"> &
  Partial<Pick<CharacterBrief, "persona_hook" | "silhouette" | "example_lines" | "face">> & {
    slug: string;
    style?: { name: string };
    parts?: readonly { name: string; what?: string; motion?: string }[];
  };

/** How the brief was chosen: the exact recorded words, some of the words, or nothing (a fallback). */
export type CastMatchHow = "exact" | "words" | "none";

export interface CastMatch {
  slug: string;
  score: number;
  matched: string[];
  how: CastMatchHow;
}

const STOP = new Set(
  (
    "a an the and or but nor so yet with without who whom whose which what that this these those of for from in into onto on to at by as " +
    "is are was were be been being am it its i me my mine we us our ours you your yours he him his she her hers they them their theirs " +
    "there here when where while how why then than very too just like make made makes making some any all each every one two three " +
    "kind sort really little big bit lot guy gal thing things something someone somebody character characters please want wants need " +
    "can could would should will shall may might must also not no yes about over under up down out off again more most much many " +
    "do does did doing have has had having get gets got let lets look looks looking type sort " +
    "spooky scary creepy horror cool cute awesome new old"
  ).split(" "),
);

/** British spellings and the like, folded before stemming. */
const FOLD: Readonly<Record<string, string>> = { armour: "armor", colour: "color", grey: "gray", ghostly: "ghost" };

/** A word's stem: plural first, else -ing / -ed when at least four letters stay. */
export function stemWord(word: string): string {
  const w = FOLD[word] ?? word;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length - 3 >= 4) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length - 2 >= 4) return w.slice(0, -2);
  return w;
}

/** The text's words that can count: [stem, the word as written], stop words and short words dropped. */
export function matchWords(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.toLowerCase().replace(/['’]s\b/g, "").split(/[^a-z]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const stem = stemWord(raw);
    if (stem.length >= 3 && !STOP.has(stem)) out.push([stem, raw]);
  }
  return out;
}

const key = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

/** FNV-1a, 32 bit. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Each stem of the brief with the best field weight it appears in. */
export function briefWeights(brief: CastBriefSummary): Map<string, number> {
  const out = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    if (text === undefined) return;
    for (const [stem] of matchWords(text)) out.set(stem, Math.max(out.get(stem) ?? 0, weight));
  };
  add(brief.name, 4);
  add(brief.one_line_request, 3);
  add(brief.archetype, 3);
  for (const p of brief.parts ?? []) {
    add(p.name, 2);
    add(p.what, 2);
    add(p.motion, 1);
  }
  add(brief.silhouette, 1);
  add(brief.persona_hook, 1);
  add(brief.style?.name, 1);
  add(brief.face?.eyes, 1);
  for (const line of brief.example_lines ?? []) add(line, 1);
  return out;
}

const bySlug = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/**
 * The recorded cast brief nearest to `request`, or undefined for an empty cast. Pure and
 * deterministic; the order of `cast` never changes the answer (see the header for the rules).
 */
export function matchCastBrief(request: string, cast: readonly CastBriefSummary[]): CastMatch | undefined {
  const ranked = [...cast].sort(bySlug);
  if (ranked.length === 0) return undefined;
  const asked = key(request);
  const exact = ranked.find((b) => key(b.one_line_request) === asked && asked !== "");
  const words = matchWords(request);
  const weights = ranked.map(briefWeights);
  const df = new Map<string, number>();
  for (const w of weights) for (const stem of w.keys()) df.set(stem, (df.get(stem) ?? 0) + 1);
  const n = ranked.length;
  const common = Math.max(1, Math.floor(n / 2));
  const scoreOf = (at: number): { score: number; matched: string[] } => {
    const seen = new Set<string>();
    const matched: string[] = [];
    let score = 0;
    for (const [stem, word] of words) {
      if (seen.has(stem)) continue;
      seen.add(stem);
      const weight = weights[at]?.get(stem);
      const d = df.get(stem) ?? 0;
      if (weight === undefined || d > common) continue;
      score += weight * Math.log((n + 1) / d);
      matched.push(word);
    }
    return { score, matched };
  };
  if (exact !== undefined) return { slug: exact.slug, ...scoreOf(ranked.indexOf(exact)), how: "exact" };
  let best: (CastMatch & { at: number }) | undefined;
  for (let at = 0; at < n; at += 1) {
    const { score, matched } = scoreOf(at);
    if (score <= 0) continue;
    if (best === undefined || score > best.score || (score === best.score && matched.length > best.matched.length)) {
      best = { slug: ranked[at]?.slug ?? "", score, matched, how: "words", at };
    }
  }
  if (best !== undefined) return { slug: best.slug, score: best.score, matched: best.matched, how: best.how };
  const pick = ranked[fnv(asked) % n];
  return pick === undefined ? undefined : { slug: pick.slug, score: 0, matched: [], how: "none" };
}

/** What the brief card says about a recorded brief chosen for a request (the wire's `match`). */
export interface CastMatchNote {
  /** The recorded character's name, as recorded. */
  name: string;
  how: CastMatchHow;
  /** The request's words that chose it (empty unless `how` is "words" or "exact"). */
  matched: string[];
}

/** A checked CastMatchNote, or undefined when the value is not one. */
export function readCastMatchNote(value: unknown): CastMatchNote | undefined {
  if (typeof value !== "object" || value === null || !("name" in value) || !("how" in value) || !("matched" in value)) return undefined;
  const { name, how, matched } = value;
  if (typeof name !== "string" || (how !== "exact" && how !== "words" && how !== "none")) return undefined;
  if (!Array.isArray(matched) || !matched.every((w): w is string => typeof w === "string")) return undefined;
  return { name, how, matched: [...matched] };
}

/** The card's one honest line: a recording, which one, and what in the request chose it. */
export function castMatchLine(note: CastMatchNote): string {
  if (note.how === "exact") return `Recorded: ${note.name}, recorded from these exact words.`;
  if (note.how === "words" && note.matched.length > 0) return `Recorded: ${note.name}, chosen for ${note.matched.map((w) => `'${w}'`).join(", ")}.`;
  return `Recorded: ${note.name}. Nothing in your words matched a recorded character, so this one is shown instead.`;
}

/** A stable id for a brief that came without its folder slug: its name, kebab-cased. */
export const castSlugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The recorded brief for `request` and the note the card shows (replay plane); undefined for no briefs. */
export function recordedBriefMatch<B extends CharacterBrief>(request: string, briefs: readonly B[]): { brief: B; match: CastMatchNote } | undefined {
  const summaries = briefs.map((brief) => ({ ...brief, slug: castSlugOf(brief.name) }));
  const match = matchCastBrief(request, summaries);
  const brief = match === undefined ? undefined : briefs[summaries.findIndex((s) => s.slug === match.slug)];
  return match === undefined || brief === undefined ? undefined : { brief, match: { name: brief.name, how: match.how, matched: match.matched } };
}
