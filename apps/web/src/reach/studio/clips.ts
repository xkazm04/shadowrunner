// Each script line's decoded clip and mouth track (perfection-pass task 6, after task 4's single
// line cache): a typed line through the voice route (live), a recorded one from its bundled clip
// (replay), decoded by the page's one AudioContext whatever the format (`decodeAudioData`), and
// analysed once with its words.
//
// Decisions:
// - Cached by what makes the sound (live: voice and text; replay: the clip URL), so Record after
//   Preview, a reorder or a mood change asks the voice for nothing again (a live line is a TTS
//   call). The cache keeps the last CLIP_CACHE entries (a script is at most 8 lines).
// - Lines are fetched one after another, not at once, so a failing live script spends no more
//   voice calls than the line that failed.
import type { MouthTrack } from "@sr/avatar/core";
import { trackOfLine } from "./lipsync";
import type { LineAudio } from "./lines";
import type { ScriptLine } from "./script";

export const CLIP_CACHE = 16;
export const NO_AUDIO = "This line's audio could not be played.";

export interface Decoded {
  buffer: AudioBuffer;
  track: MouthTrack | undefined;
}

export interface ClipDeps {
  context: Pick<BaseAudioContext, "decodeAudioData">;
  /** `live|voice|text` or `replay|url`. */
  keyOf(line: ScriptLine): string;
  /** The line's encoded audio (lines.ts `liveAudio` / `recordedAudio`). */
  fetchLine(line: ScriptLine): Promise<LineAudio>;
  /** Analyses a decoded clip with its words (default lipsync.ts `trackOfLine`). */
  analyse?: (buffer: AudioBuffer, text: string) => MouthTrack | undefined;
}

export type ClipCache = Map<string, Decoded>;

/** Every line decoded, in order, or the first line's failure as a sentence (with its 1-based number when there are several). */
export async function decodeScript(lines: readonly ScriptLine[], cache: ClipCache, deps: ClipDeps): Promise<{ ok: true; decoded: Decoded[] } | { ok: false; error: string }> {
  const decoded: Decoded[] = [];
  const say = (i: number, error: string): string => (lines.length > 1 ? `Line ${i + 1}: ${error}` : error);
  for (const [i, line] of lines.entries()) {
    const key = deps.keyOf(line);
    const hit = cache.get(key);
    if (hit !== undefined) {
      decoded.push(hit);
      continue;
    }
    const audio = await deps.fetchLine(line);
    if (!audio.ok) return { ok: false, error: say(i, audio.error) };
    let buffer: AudioBuffer;
    try {
      buffer = await deps.context.decodeAudioData(audio.bytes);
    } catch {
      return { ok: false, error: say(i, NO_AUDIO) };
    }
    const entry = { buffer, track: (deps.analyse ?? trackOfLine)(buffer, line.text.trim()) };
    cache.set(key, entry);
    while (cache.size > CLIP_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    decoded.push(entry);
  }
  return { ok: true, decoded };
}
