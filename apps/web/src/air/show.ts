// The on-air show (voice-and-air task 5.2, requirements 3.4, 4.3, 4.5): the chat, one show clock and
// the beat loop pick -> reply -> voice -> play -> captions. A plain controller with injected
// fetch, clock, timers and player, so the loop is tested without a browser; useShow.ts binds it
// to React.
//
// One clock (task 5 note from the 1.1 review): every chat message, audience and visitor alike, is
// stamped by the same monotonic show clock before it reaches `pickMessage`, and the clock never
// hands out the same stamp twice, so a visitor typing in the same millisecond as a pick is still
// newer than the picked message and is answered on the next beat. `ctx.self` is the name the
// character's replies are posted under.
//
// Decisions the spec leaves open:
// - A beat ends when the line's audio ends; a line without audio (TTS failed twice, or the
//   browser has not allowed sound yet) holds its caption for BEAT_MS, the 9 s default beat.
// - The simulated audience replays the show file's messages at their offsets, looping, with ids
//   suffixed per loop so no id repeats.
// - An engine error skips the beat and tries again one beat later.
import {
  parseReply,
  pickMessage,
  initialPickState,
  MAX_CHAT_CHARS,
  MAX_CHAT_MESSAGES,
  type ChatMsg,
  type EngineReply,
  type EngineRequest,
  type Persona,
  type PickState,
  type ShowScript,
} from "@sr/engine";
import type { Fetcher } from "../app/plane";

/** The default beat, and how long a caption-only line stays up (requirement 4.3). */
export const BEAT_MS = 9_000;
/** Messages the stage keeps on screen and in memory. */
export const CHAT_KEEP = 60;
/** The visitor's name in chat. */
export const VISITOR_NAME = "you";
/** Voice requests per line: the first and one retry (requirement 3.4). */
export const VOICE_ATTEMPTS = 2;

export type StageStatus = "booting" | "on_air" | "speaking" | "dead_line";

export interface Caption {
  beat: number;
  line: string;
  reply: EngineReply;
  /** The chat message the line answers, when it is still on screen. */
  answered?: ChatMsg;
  /** False when the line plays as a caption only (no audio, mouth closed). */
  voiced: boolean;
}

export interface ShowSnapshot {
  status: StageStatus;
  chat: readonly ChatMsg[];
  caption?: Caption;
  /** "blocked" until the browser lets the stage play sound. */
  sound: "on" | "blocked";
  beat: number;
}

export type PlayResult = "ended" | "blocked" | "error";

export interface VoicePlayer {
  /** Plays a WAV URL; resolves when it ends or could not play. */
  play(url: string): Promise<PlayResult>;
  stop(): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ShowDeps {
  show: ShowScript;
  persona: Persona;
  /** The character's chat name (`ctx.self`). */
  self: string;
  fetch: Fetcher;
  /** Monotonic milliseconds (performance.now in the browser). */
  now(): number;
  timers: Timers;
  player: VoicePlayer;
  /** Blob -> URL for the player, and its release. */
  objectUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}

/** The show clock: whole ms since start, strictly increasing per stamp. */
export interface ShowClock {
  /** Now on the show clock (for the picker's recency). */
  read(): number;
  /** A fresh stamp for a chat message: never equal to an earlier one. */
  stamp(): number;
}

export function createShowClock(now: () => number): ShowClock {
  const start = now();
  let last = Number.NEGATIVE_INFINITY;
  const elapsed = () => Math.max(0, Math.floor(now() - start));
  return {
    read: () => Math.max(elapsed(), last),
    stamp() {
      last = Math.max(elapsed(), last + 1);
      return last;
    },
  };
}

/** The audience loop length: the last message or beat, plus one beat. */
export function showPeriod(show: ShowScript): number {
  const lastMsg = Math.max(0, ...show.audience.map((m) => m.ts));
  const lastBeat = Math.max(0, ...show.beats.map((b) => b.at));
  return Math.max(lastMsg, lastBeat) + BEAT_MS;
}

export interface Show {
  subscribe(listener: () => void): () => void;
  snapshot(): ShowSnapshot;
  start(): void;
  stop(): void;
  /** The visitor's message; false when empty after trimming. */
  post(text: string): boolean;
  /** The visitor allowed sound (a click): later lines play. */
  soundOn(): void;
}

async function requestReply(fetch: Fetcher, req: EngineRequest): Promise<EngineReply> {
  const res = await fetch("/api/engine/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`engine ${res.status}`);
  return parseReply(await res.text());
}

async function requestVoice(fetch: Fetcher, text: string, persona: Persona): Promise<Blob> {
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify({ text, voice: persona.voice }),
  });
  if (!res.ok) throw new Error(`voice ${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("voice: empty body");
  return blob;
}

export function createShow(deps: ShowDeps): Show {
  const { show, persona, self, timers, player } = deps;
  const clock = createShowClock(deps.now);
  const period = showPeriod(show);
  const listeners = new Set<() => void>();
  let snap: ShowSnapshot = { status: "booting", chat: [], sound: "on", beat: 0 };
  let pickState: PickState = initialPickState();
  let running = false;
  let generation = 0;
  let audienceAt = 0;
  let visitorCount = 0;
  let beatTimer: unknown;
  let audienceTimer: unknown;
  let currentUrl: string | undefined;

  const set = (patch: Partial<ShowSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const listener of listeners) listener();
  };

  const append = (msg: ChatMsg) => set({ chat: [...snap.chat, msg].slice(-CHAT_KEEP) });

  /** Posts every audience message due by now; schedules the next one. */
  const postAudience = () => {
    if (!running || show.audience.length === 0) return;
    const n = show.audience.length;
    for (;;) {
      const loop = Math.floor(audienceAt / n);
      const msg = show.audience[audienceAt % n];
      if (msg === undefined) return;
      const due = loop * period + msg.ts;
      const wait = due - clock.read();
      if (wait > 0) {
        audienceTimer = timers.set(postAudience, wait);
        return;
      }
      append({ ...msg, id: loop === 0 ? msg.id : `${msg.id}.${loop}`, ts: clock.stamp() });
      audienceAt += 1;
    }
  };

  const release = () => {
    if (currentUrl !== undefined) deps.revokeUrl(currentUrl);
    currentUrl = undefined;
  };

  const schedule = (ms: number, gen: number) => {
    timers.clear(beatTimer);
    beatTimer = timers.set(() => {
      if (gen === generation) void runBeat(gen);
    }, ms);
  };

  /** The voice for one line: one retry, then none (requirement 3.4). */
  const voiceFor = async (line: string): Promise<Blob | undefined> => {
    for (let attempt = 0; attempt < VOICE_ATTEMPTS; attempt += 1) {
      try {
        return await requestVoice(deps.fetch, line, persona);
      } catch {
        // The next attempt, or captions only.
      }
    }
    return undefined;
  };

  const runBeat = async (gen: number): Promise<void> => {
    const beat = snap.beat;
    const { picked, state } = pickMessage(snap.chat, pickState, { self, now: clock.read() });
    pickState = state;
    const req: EngineRequest = {
      characterId: show.characterId,
      persona,
      chat: snap.chat.slice(-MAX_CHAT_MESSAGES),
      beat,
      ...(picked === undefined ? {} : { pickedId: picked.id }),
    };
    let reply: EngineReply;
    try {
      reply = await requestReply(deps.fetch, req);
    } catch {
      if (gen !== generation) return;
      set({ status: "on_air" });
      schedule(BEAT_MS, gen);
      return;
    }
    if (gen !== generation) return;
    const answered = reply.answeredId === undefined ? undefined : snap.chat.find((m) => m.id === reply.answeredId);
    append({ id: `r${beat}`, user: self, text: reply.line, ts: clock.stamp() });
    const caption = (voiced: boolean): Caption => ({ beat, line: reply.line, reply, voiced, ...(answered === undefined ? {} : { answered }) });
    set({ beat: beat + 1 });

    const blob = await voiceFor(reply.line);
    if (gen !== generation) return;
    if (blob === undefined) {
      set({ status: "speaking", caption: caption(false) });
      schedule(BEAT_MS, gen);
      return;
    }
    release();
    const url = deps.objectUrl(blob);
    currentUrl = url;
    set({ status: "speaking", caption: caption(snap.sound === "on") });
    const startedAt = deps.now();
    const result = snap.sound === "on" ? await player.play(url) : "blocked";
    if (gen !== generation) return;
    if (result === "ended") {
      set({ status: "on_air" });
      schedule(0, gen);
      return;
    }
    // Could not play: the caption stays up for the rest of a default beat, mouth closed.
    set({ caption: caption(false), ...(result === "blocked" ? { sound: "blocked" as const } : {}) });
    schedule(Math.max(0, BEAT_MS - (deps.now() - startedAt)), gen);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snap,
    start() {
      if (running) return;
      running = true;
      generation += 1;
      set({ status: "on_air" });
      postAudience();
      schedule(0, generation);
    },
    stop() {
      running = false;
      generation += 1;
      timers.clear(beatTimer);
      timers.clear(audienceTimer);
      player.stop();
      release();
    },
    post(text) {
      const clean = text.trim().slice(0, MAX_CHAT_CHARS);
      if (clean.length === 0) return false;
      visitorCount += 1;
      append({ id: `v${visitorCount}`, user: VISITOR_NAME, text: clean, ts: clock.stamp(), fromVisitor: true });
      return true;
    },
    soundOn() {
      set({ sound: "on" });
    },
  };
}
