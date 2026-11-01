// ScriptedEngine (voice-and-air requirement 1.2): answers from a recorded show, deterministically
// for a given (seed, beat). No clock, no randomness, no state between calls: the same request
// always gets the same reply. The show is passed in (already validated by parseShow), so the
// package never touches the file system.
import type { Engine, EngineReply, EngineRequest, ShowBeat, ShowScript } from "./types.js";

/** `n mod m` in [0, m) for any integer n, negative included. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Beat index `b` (+ seed) -> position in the show; non-finite input counts as 0. */
export function beatIndex(show: ShowScript, beat: number, seed = 0): number {
  const b = Number.isFinite(beat) ? Math.trunc(beat) : 0;
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return mod(b + s, show.beats.length);
}

function copyReply(reply: EngineReply): EngineReply {
  return { ...reply };
}

/** The first generic beat (no `replyTo`) at or after `from`, wrapping around. */
function nextGeneric(show: ShowScript, from: number): ShowBeat {
  const n = show.beats.length;
  for (let k = 0; k < n; k += 1) {
    const beat = show.beats[(from + k) % n];
    if (beat !== undefined && beat.replyTo === undefined) return beat;
  }
  throw new Error(`show ${show.id} has no generic beat`);
}

/**
 * The scripted reply for one request: `beats[(beat + seed) mod n]`. When `pickedId` names a
 * visitor's message in `req.chat`, the next generic beat answers it instead and its
 * `answeredId` is the visitor's message, so visitors get an answer without a model.
 */
export function scriptedReply(show: ShowScript, req: EngineRequest): EngineReply {
  const index = beatIndex(show, req.beat, req.seed);
  const picked = req.pickedId === undefined ? undefined : req.chat.find((m) => m.id === req.pickedId);
  if (picked?.fromVisitor) {
    const { line, emotion, gesture } = nextGeneric(show, index).reply;
    return { line, emotion, ...(gesture === undefined ? {} : { gesture }), answeredId: picked.id };
  }
  const beat = show.beats[index];
  if (beat === undefined) throw new Error(`show ${show.id} has no beats`);
  return copyReply(beat.reply);
}

/** The replay engine. Construct with a validated show (`parseShowJson`). */
export class ScriptedEngine implements Engine {
  readonly kind = "scripted";
  readonly #show: ShowScript;

  constructor(show: ShowScript) {
    if (show.beats.length === 0) throw new Error(`show ${show.id} has no beats`);
    this.#show = show;
  }

  /** The show this engine answers from (the voice replay maps its lines to WAVs). */
  get show(): ShowScript {
    return this.#show;
  }

  reply(req: EngineRequest): Promise<EngineReply> {
    return Promise.resolve(scriptedReply(this.#show, req));
  }
}
