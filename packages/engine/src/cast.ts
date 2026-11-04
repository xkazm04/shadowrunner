// Who speaks in which voice on the replay plane, and which recorded clip answers a line.
//
// Every seeded character has a recorded show (`assets/replay/shows/<slug>-night.json`: its own
// scripted audience and lines, `fictional: true`) and a cast voice. A clip is a WAV that really
// exists under assets/replay/shows/, listed in `recorded.json`; a clip is only ever played in the
// voice it was rendered with, which is the character's cast voice. Nothing here is faked: a line
// with no recording resolves to `undefined`, and the stage shows it as a caption (requirement 3.4).
import type { ShowScript } from "./types.js";
import type { VoiceId } from "./voices.js";

/** Cast slug -> its voice. Malakor uses `clerk` (voice-and-air design.md). */
export const CAST_VOICES: Readonly<Record<string, VoiceId>> = {
  malakor: "clerk",
  "auntie-asp": "velvet",
  "lot-ninety": "rasp",
  reveille: "rasp",
  "saint-cardia": "choir",
  "sir-vacant": "crypt",
  "the-redactor": "clerk",
  "the-tallyman": "clerk",
  "vicar-of-the-lure": "crypt",
  "announcer-of-dead-air": "choir",
  "lantern-warden": "crypt",
  "moth-widow": "velvet",
  "sister-vesper": "choir",
  understudy: "clerk",
};

/** Library record ids of recorded forge jobs are `replay-<slug>`; Malakor's is `malakor`. */
export function castSlug(characterId: string): string {
  return characterId.startsWith("replay-") ? characterId.slice("replay-".length) : characterId;
}

/** The cast voice of a character (by library id or slug), or undefined for anyone not in the cast. */
export function castVoice(characterId: string): VoiceId | undefined {
  const slug = castSlug(characterId);
  return Object.hasOwn(CAST_VOICES, slug) ? CAST_VOICES[slug] : undefined;
}

/** The show of a cast character (by library id or slug), if the bank holds one. */
export function showOf(shows: readonly ShowScript[], characterId: string): ShowScript | undefined {
  const slug = castSlug(characterId);
  return shows.find((s) => s.characterId === slug);
}

/** A clip to play: the WAV path relative to `assets/replay/shows/`, and whether it stands in for the line. */
export interface Recording {
  wav: string;
  fallback: boolean;
}

/** The recorded shows and the set of WAV paths that exist. */
export interface ShowBank {
  shows: readonly ShowScript[];
  recorded: ReadonlySet<string>;
}

/** The recorded beat of `show` whose line is exactly `text`, else its last recorded generic line. */
export function showRecording(show: ShowScript, text: string, recorded: ReadonlySet<string>): Recording | undefined {
  const line = text.trim();
  const hit = show.beats.find((b) => b.reply.line === line && recorded.has(b.wav));
  if (hit) return { wav: hit.wav, fallback: false };
  const generic = show.beats.filter((b) => b.replyTo === undefined && recorded.has(b.wav));
  const last = generic.at(-1);
  return last === undefined ? undefined : { wav: last.wav, fallback: true };
}

/**
 * The clip for `text` spoken in `voice` by `characterId` (a cast character's id, slug, or absent):
 * - a cast character: its own show, and only in its cast voice (the clips were rendered with it);
 * - anyone else (a forged character, or no id): a line of any show recorded in `voice`, else the
 *   voice's recorded generic line. Today only `clerk` has recordings (Malakor's).
 * Undefined when nothing is recorded in that voice for the line.
 */
export function findRecording(bank: ShowBank, text: string, voice: VoiceId, characterId?: string): Recording | undefined {
  const own = characterId === undefined ? undefined : showOf(bank.shows, characterId);
  if (own !== undefined) return castVoice(own.characterId) === voice ? showRecording(own, text, bank.recorded) : undefined;
  const inVoice = bank.shows.filter((s) => castVoice(s.characterId) === voice);
  const line = text.trim();
  for (const show of inVoice) {
    const hit = show.beats.find((b) => b.reply.line === line && bank.recorded.has(b.wav));
    if (hit) return { wav: hit.wav, fallback: false };
  }
  for (const show of inVoice) {
    const fallback = showRecording(show, "", bank.recorded);
    if (fallback !== undefined) return fallback;
  }
  return undefined;
}

/**
 * A character's bible for the live engine and the cast's example lines: the name, one hook line,
 * and a few of its own scripted lines as the register to keep. Malakor has a written bible and does not use this.
 */
export function castBible(name: string, hook: string, show: ShowScript | undefined): string {
  const lines = (show?.beats ?? []).filter((b) => b.replyTo === undefined).map((b) => `- ${b.reply.line}`);
  return [`# ${name}`, "", hook.trim(), "", "Original fiction. Speak in this register:", ...lines].join("\n");
}
