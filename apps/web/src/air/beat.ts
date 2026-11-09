// One beat in flight (perfection-pass 5.4): its reply, then its voice, behind an AbortController.
// The show controller (show.ts) holds at most one of these, launched either when the stage is
// free (the serial path) or, on the live plane, as soon as a line starts playing (the prefetch),
// so the next line is ready when this one ends. Pure of React and of the show's state: the caller
// picks the message and builds the request, and reads `stage` / `reply` to show the wait.
//
// Rules this file keeps:
// - The voice is fetched only after the reply (it speaks the reply's line); one retry, then the
//   line plays as captions only (requirement 3.4 of voice-and-air, unchanged).
// - A fetched clip becomes an object URL as soon as it lands, and its mouth track is started then
//   (`analyse`, mouthTrack.ts), so a prefetched line's lip-sync is ready when it starts.
// - An aborted beat resolves "aborted", whatever was in flight; an object URL it made is revoked.
//   Nothing here retries an aborted beat.
import { parseReply, type ChatMsg, type EngineReply, type EngineRequest, type Persona } from "@sr/engine";
import type { Fetcher } from "../app/plane";

/** Voice requests per line: the first and one retry (voice-and-air requirement 3.4). */
export const VOICE_ATTEMPTS = 2;

export async function requestReply(fetch: Fetcher, req: EngineRequest, signal?: AbortSignal): Promise<EngineReply> {
  const res = await fetch("/api/engine/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok) throw new Error(`engine ${res.status}`);
  return parseReply(await res.text());
}

/** POST /api/voice -> the WAV Blob (also the studio's live voice, spec avatar-reach). */
export async function requestVoice(fetch: Fetcher, text: string, persona: Persona, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify({ text, voice: persona.voice, characterId: persona.characterId }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok) throw new Error(`voice ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("voice: empty body");
  return blob;
}

/** A line ready to air. `owned`: `url` is an object URL the show revokes when the line is done. */
export interface ReadyBeat {
  beat: number;
  reply: EngineReply;
  picked?: ChatMsg;
  url?: string;
  owned: boolean;
}

export type BeatOutcome = { kind: "ready"; ready: ReadyBeat } | { kind: "failed" } | { kind: "aborted" };

export interface InFlight {
  readonly beat: number;
  /** The chat message this beat answers, when one was picked. */
  readonly picked?: ChatMsg;
  /** Launched while a line was playing (live prefetch), not when the stage was free. */
  readonly prefetched: boolean;
  /** What it waits on now. */
  readonly stage: "reply" | "voice" | "done";
  /** The reply, once it has arrived. */
  readonly reply?: EngineReply;
  readonly outcome: Promise<BeatOutcome>;
  abort(): void;
}

export interface BeatSource {
  /** The engine's reply for `req` (a fetch, or the local sheet script). */
  reply(req: EngineRequest, signal: AbortSignal): Promise<EngineReply>;
  /** The line's clip: an object URL it made (`owned`), a static recording, or none (captions only). Never rejects in practice; a rejection counts as none. */
  voice(line: string, signal: AbortSignal): Promise<{ url: string; owned: boolean } | undefined>;
  revokeUrl(url: string): void;
  /** Called when `stage` or `reply` changes, so the show can show the wait. */
  changed(): void;
}

/** Launches one beat: reply, then voice. The outcome never rejects. */
export function launchBeat(req: EngineRequest, picked: ChatMsg | undefined, prefetched: boolean, source: BeatSource): InFlight {
  const controller = new AbortController();
  const { signal } = controller;
  const state: { stage: InFlight["stage"]; reply?: EngineReply; owned?: string } = { stage: "reply" };
  const run = async (): Promise<BeatOutcome> => {
    let reply: EngineReply;
    try {
      reply = await source.reply(req, signal);
    } catch {
      return signal.aborted ? { kind: "aborted" } : { kind: "failed" };
    }
    if (signal.aborted) return { kind: "aborted" };
    state.reply = reply;
    state.stage = "voice";
    source.changed();
    const clip = await source.voice(reply.line, signal).catch(() => undefined);
    if (signal.aborted) {
      if (clip?.owned === true) source.revokeUrl(clip.url);
      return { kind: "aborted" };
    }
    state.stage = "done";
    if (clip?.owned === true) state.owned = clip.url;
    const ready: ReadyBeat = { beat: req.beat, reply, owned: clip?.owned === true, ...(picked === undefined ? {} : { picked }), ...(clip === undefined ? {} : { url: clip.url }) };
    return { kind: "ready", ready };
  };
  const outcome = run();
  return {
    beat: req.beat,
    ...(picked === undefined ? {} : { picked }),
    prefetched,
    get stage() {
      return state.stage;
    },
    get reply() {
      return state.reply;
    },
    outcome,
    abort() {
      // A beat that finished but never aired still holds its clip: release it here.
      if (!signal.aborted && state.owned !== undefined) source.revokeUrl(state.owned);
      controller.abort();
    },
  };
}

/** The voice for one line from the voice endpoint: one retry, then none (captions only). */
export async function voiceFor(fetch: Fetcher, line: string, persona: Persona, signal: AbortSignal): Promise<Blob | undefined> {
  for (let attempt = 0; attempt < VOICE_ATTEMPTS; attempt += 1) {
    if (signal.aborted) return undefined;
    try {
      return await requestVoice(fetch, line, persona, signal);
    } catch {
      // The next attempt, or captions only.
    }
  }
  return undefined;
}
