// "Speak a line" on replay (creator requirement 1.4): a recorded line from the replay show
// (assets/replay/shows/*.json, validated by `parseShow`) and its WAV, which drives the mouth
// through <AvatarCanvas audio>.
//
// Decisions the spec leaves open:
// - The only recorded voice is Malakor's show (voice `clerk`). Every character speaks those lines
//   on replay; the panel says so. Lines that answer a chat user are skipped (they name viewers who
//   are not in the creator); the standalone lines play in turn.
// - The show is loaded on first use (a separate chunk), and the WAVs are plain asset URLs, so
//   nothing is fetched until someone presses the button.
import { parseShow, type EngineReply } from "@sr/engine";

export interface SpokenLine {
  /** The WAV to play. */
  url: string;
  reply: EngineReply;
}

const SHOWS = import.meta.glob<unknown>("../../../../assets/replay/shows/*.json", { import: "default" });
const WAVS = import.meta.glob<string>("../../../../assets/replay/shows/*/*.wav", { eager: true, query: "?url", import: "default" });

/** `<show>/<file>.wav` (as a beat names it) -> bundled URL. */
function wavUrl(wav: string): string | undefined {
  for (const [path, url] of Object.entries(WAVS)) if (path.endsWith(`/shows/${wav}`)) return url;
  return undefined;
}

/** The speakable lines of one show value: standalone beats with a WAV, in show order. */
export function linesOf(show: unknown, urlOf: (wav: string) => string | undefined = wavUrl): SpokenLine[] {
  const script = parseShow(show);
  if (script === undefined) return [];
  const own = script.beats.filter((b) => b.replyTo === undefined);
  const lines: SpokenLine[] = [];
  for (const beat of own.length > 0 ? own : script.beats) {
    const url = urlOf(beat.wav);
    if (url !== undefined) lines.push({ url, reply: beat.reply });
  }
  return lines;
}

let loaded: Promise<SpokenLine[]> | undefined;

/** Every recorded line of every committed show. Loaded once. */
export function loadLines(): Promise<SpokenLine[]> {
  loaded ??= (async () => {
    const shows = await Promise.all(Object.values(SHOWS).map((load) => load()));
    return shows.flatMap((show) => linesOf(show));
  })();
  return loaded;
}

/** The line for press number `n` (0-based), cycling. */
export function lineAt(lines: readonly SpokenLine[], n: number): SpokenLine | undefined {
  return lines.length === 0 ? undefined : lines[((n % lines.length) + lines.length) % lines.length];
}
