// C4, a forged co-host on air as itself. A character the streamer forged has no recorded show; when
// its library record carries a character sheet (the brief they approved: archetype, persona hook,
// up to three example lines) the stage builds its persona from the sheet, and on the replay plane
// plays a short looped script of the sheet's own lines, answered in the browser (no engine call)
// and labelled SCRIPTED inside the RECORDED plane. A line has audio only when a recording of
// exactly that line exists in the character's voice; otherwise it is a caption.
// Pure: no DOM, no fetch.
import { castBible, castVoice, scriptedReply, type EngineReply, type EngineRequest, type ShowBank, type ShowScript, type VoiceId } from "@sr/engine";
import type { CharacterSheet } from "@sr/pack";
import { BEAT_MS } from "./show";

/** A sheet show's id: `<characterId>` + this. */
export const SHEET_SHOW_SUFFIX = "-sheet";
/** Where the deploy serves assets/replay/shows/** (api/voice.ts REPLAY_SHOWS_URL). */
export const REPLAY_SHOWS_URL = "/replay/shows/";
/** A hook standing in for missing lines is cut to this many characters (BRIEF_LIMITS.example_line). */
export const HOOK_LINE_CHARS = 160;

/** `text` cut at the last sentence end that fits in `max` characters (hard cut when none does). */
function firstSentences(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? head.slice(0, end + 1) : head.trimEnd();
}

/** The lines the script plays: the sheet's own example lines, or (a sheet without any) its hook as the one line. */
export function scriptLines(sheet: CharacterSheet): string[] {
  const lines = sheet.lines.map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length > 0) return lines;
  const hook = firstSentences(sheet.hook, HOOK_LINE_CHARS);
  return [hook === "" ? sheet.archetype.trim() : hook];
}

/**
 * The sheet's script as a show: one generic beat per line, a beat apart, no audience, no recordings
 * (`wav` empty). Finite; the scripted engine loops it (`beat mod lines`). Never empty, only the
 * sheet's lines, the same show for the same input.
 */
export function sheetShow(characterId: string, sheet: CharacterSheet): ShowScript {
  return {
    id: `${characterId}${SHEET_SHOW_SUFFIX}`,
    characterId,
    fictional: true,
    audience: [],
    beats: scriptLines(sheet).map((line, i) => ({ at: i * BEAT_MS, reply: { line, emotion: "neutral" }, wav: "" })),
  };
}

/** The persona bible for the live engine: name and hook (castBible), the archetype, and the sheet's lines as the register. */
export function sheetBible(name: string, sheet: CharacterSheet, acts: readonly { layer: string; cue: readonly string[] }[] = []): string {
  const hook = `${sheet.hook.trim()}\n\nArchetype: ${sheet.archetype.trim()}`;
  // tiger L1: one sentence per signature act, so the live engine says its cue word now and then.
  const moves = acts.map((a) => `Your signature move (${a.layer.replace(/_/g, " ")}) plays when you say "${a.cue[0] ?? ""}": say it when the moment earns it.`);
  return [castBible(name, hook, undefined), ...sheet.lines.map((line) => `- ${line.trim()}`), ...moves].join("\n");
}

/** The static URL of a recording named relative to assets/replay/shows/, each segment encoded. */
export function recordingUrl(wav: string): string {
  return `${REPLAY_SHOWS_URL}${wav.split(/[/\\]/).map(encodeURIComponent).join("/")}`;
}

/** A recording of exactly `line` in `voice` (any show recorded in that voice), never a stand-in phrase. */
export function exactRecording(bank: ShowBank, line: string, voice: VoiceId): string | undefined {
  const text = line.trim();
  for (const show of bank.shows) {
    if (castVoice(show.characterId) !== voice) continue;
    const hit = show.beats.find((b) => b.reply.line === text && b.wav !== "" && bank.recorded.has(b.wav));
    if (hit !== undefined) return recordingUrl(hit.wav);
  }
  return undefined;
}

/** What the stage runs instead of the engine and the voice endpoint: replies and recordings in the browser. */
export interface LocalScript {
  reply(req: EngineRequest): EngineReply;
  /** The URL of a recording of exactly this line, else undefined (the line is a caption). */
  recording(line: string): string | undefined;
}

/** The local script for a sheet show: the scripted engine over it, and exact recordings in `voice` only. */
export function localScript(show: ShowScript, voice: VoiceId, bank: ShowBank): LocalScript {
  return { reply: (req) => scriptedReply(show, req), recording: (line) => exactRecording(bank, line, voice) };
}
