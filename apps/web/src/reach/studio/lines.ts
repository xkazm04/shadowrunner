// What the studio's character says (spec avatar-reach, design "Studio", requirement 4.2).
// - Live plane: the typed line through POST /api/voice (the air stage's `requestVoice`).
// - Replay plane: a list of recorded show lines, played from their bundled WAV URLs, so it works
//   with no /api at all (`pnpm dev`). The shows are the air page's (`castShows`), the lines and
//   their WAV URLs the creator's (`linesOf`): nothing here lists them a second time.
//
// Decisions the spec leaves open:
// - A character's own show is found as the air page finds it (`showOf`, by library id or cast
//   slug), and its lines are offered only in the voice they were recorded in (`castVoice`).
// - When a character has no recorded line of its own (today every cast member but Malakor), the
//   studio offers the lines recorded in the same voice by another show, and says whose they are:
//   the clip is still played only in the voice it was rendered with (engine cast.ts). A voice
//   nobody recorded in has no list, and the page says so.
import { castSlug, castVoice, MAX_VOICE_CHARS, showOf, type ShowScript, type VoiceId } from "@sr/engine";
import { castShows } from "../../air/cast";
import { requestVoice } from "../../air/show";
import type { Fetcher } from "../../app/plane";
import { linesOf } from "../../creator/speak";

/** The /api/voice limit (requirement 4.2). */
export const MAX_LINE_CHARS = MAX_VOICE_CHARS;

export interface StudioLine {
  text: string;
  /** The bundled WAV. */
  url: string;
}

export interface ReplayLines {
  lines: StudioLine[];
  /** The cast slug whose show the lines come from, when it is not the character's own. */
  borrowedFrom?: string;
}

export interface Speaker {
  id: string;
  name: string;
  voice: VoiceId;
}

type UrlOf = (wav: string) => string | undefined;

function recorded(show: ShowScript, urlOf: UrlOf | undefined): StudioLine[] {
  return (urlOf === undefined ? linesOf(show) : linesOf(show, urlOf)).map((line) => ({ text: line.reply.line, url: line.url }));
}

/** The recorded lines `who` can say on the replay plane (see the header for the borrowing rule). */
export function replayLines(who: Pick<Speaker, "id" | "voice">, shows: readonly ShowScript[] = castShows(), urlOf?: UrlOf): ReplayLines {
  const own = showOf(shows, who.id);
  if (own !== undefined && castVoice(own.characterId) === who.voice) {
    const lines = recorded(own, urlOf);
    if (lines.length > 0) return { lines };
  }
  const slug = castSlug(who.id);
  for (const show of shows) {
    if (show.characterId === slug || castVoice(show.characterId) !== who.voice) continue;
    const lines = recorded(show, urlOf);
    if (lines.length > 0) return { lines, borrowedFrom: show.characterId };
  }
  return { lines: [] };
}

/** "the-tallyman" -> "The Tallyman" (for the borrowed-lines note). */
export function slugName(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join(" ");
}

export const VOICE_FAILED = "The voice did not answer. Try again in a moment.";
export const LINE_MISSING = "That recorded line could not be loaded.";
export const LINE_EMPTY = "Type a line first.";
export const LINE_TOO_LONG = `A line is at most ${MAX_LINE_CHARS} characters.`;

export type LineAudio = { ok: true; bytes: ArrayBuffer } | { ok: false; error: string };

/** The typed line is sendable: the trimmed text, or the sentence that says why not. */
export function checkLine(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const clean = text.trim();
  if (clean.length === 0) return { ok: false, error: LINE_EMPTY };
  if (clean.length > MAX_LINE_CHARS) return { ok: false, error: LINE_TOO_LONG };
  return { ok: true, text: clean };
}

/** Live: the typed line in `who`'s voice, through /api/voice. */
export async function liveAudio(fetcher: Fetcher, text: string, who: Speaker): Promise<LineAudio> {
  const checked = checkLine(text);
  if (!checked.ok) return checked;
  try {
    const blob = await requestVoice(fetcher, checked.text, { characterId: who.id, name: who.name, bible: "", voice: who.voice });
    return { ok: true, bytes: await blob.arrayBuffer() };
  } catch {
    return { ok: false, error: VOICE_FAILED };
  }
}

/** Replay: a recorded line's WAV (a static asset, no /api). */
export async function recordedAudio(fetcher: Fetcher, line: StudioLine): Promise<LineAudio> {
  try {
    const response = await fetcher(line.url);
    if (!response.ok) return { ok: false, error: LINE_MISSING };
    return { ok: true, bytes: await response.arrayBuffer() };
  } catch {
    return { ok: false, error: LINE_MISSING };
  }
}
