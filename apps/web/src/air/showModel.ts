// The show's model (voice-and-air task 5.2; split from show.ts in perfection-pass 5 for the line
// cap): its constants, the snapshot and dependency types, the one show clock and the audience
// period. show.ts re-exports all of it, so importers keep reading "./show".
import type { ChatMsg, EngineReply, Persona, ShowScript } from "@sr/engine";
import type { Fetcher } from "../app/plane";
import type { ChatMarks } from "./chatMarks";
import type { LocalScript } from "./sheetShow";

/** The default beat, and how long a caption-only line stays up (requirement 4.3). */
export const BEAT_MS = 9_000;
/** Messages the stage keeps on screen and in memory. */
export const CHAT_KEEP = 60;
/** The visitor's name in chat. */
export const VISITOR_NAME = "you";
/** A wait shorter than this never shows the thinking state (perfection-pass 5.1). */
export const THINK_DELAY_MS = 250;

export type StageStatus = "booting" | "on_air" | "speaking" | "dead_line";

/** A chat entry on the stage: `queued` while a visitor's message waits to be picked (omitted otherwise). */
export type AirMsg = ChatMsg & { queued?: true };

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
  chat: readonly AirMsg[];
  caption?: Caption;
  /** "blocked" until the browser lets the stage play sound. */
  sound: "on" | "blocked";
  beat: number;
  /** What the stage waits on with no line up, once the wait has lasted THINK_DELAY_MS. */
  pending: "reply" | "voice" | undefined;
  /** The next line's reply, from the moment it lands with no line up until the line starts. */
  upcoming?: EngineReply;
  /** The id of the chat message the beat in flight answers, until its line starts. */
  answering?: string;
  /** One lifecycle mark per chat id (chatMarks.ts): queued, pending, answering, answered, passed or none. */
  marks?: ChatMarks;
  /** challenge-2026-11-17 air/B, the producer desk (showDesk.ts): the show is held (a BRB). */
  held?: true;
  /** The chat id the next pick takes. */
  cued?: string;
}

/** The show controller (show.ts createShow). */
export interface Show {
  subscribe(listener: () => void): () => void;
  snapshot(): ShowSnapshot;
  /** Now on the show clock (the clock chat stamps use). */
  now(): number;
  start(): void;
  stop(): void;
  /** The visitor's message; false when empty after trimming. */
  post(text: string): boolean;
  /** The visitor allowed sound (a click): later lines play. */
  soundOn(): void;
  /** The desk: hold the show (the line on air finishes), resume it, cut the line, cue a message next. False when the desk does not take it now. */
  hold(): boolean;
  resume(): boolean;
  skip(): boolean;
  cue(id: string): boolean;
}

export type PlayResult = "ended" | "blocked" | "error";

export interface VoicePlayer {
  /** Plays a WAV URL; resolves when it ends or could not play. `text` is the line it speaks (lip-sync). */
  play(url: string, text?: string): Promise<PlayResult>;
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
  /** One /api/health read: true when it answered and the engine is not offline. */
  health(): Promise<boolean>;
  /** Monotonic milliseconds (performance.now in the browser). */
  now(): number;
  timers: Timers;
  player: VoicePlayer;
  /** Blob -> URL for the player, and its release. */
  objectUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  /** C4, a sheet show on replay: replies and recordings come from here; no engine or voice request is made. */
  local?: LocalScript;
  /** perfection-pass 5.4, LIVE only: fetch the next beat while a line plays. Default off. */
  prefetch?: boolean;
  /** Starts a fetched clip's mouth track as it lands (mouthTrack.ts `trackForClip`). */
  analyse?(url: string, text: string): unknown;
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

/** A chat entry as the engine sees it (no stage marks). */
export function plainMsg(m: AirMsg): ChatMsg {
  return { id: m.id, user: m.user, text: m.text, ts: m.ts, ...(m.fictional ? { fictional: true } : {}), ...(m.fromVisitor ? { fromVisitor: true } : {}) };
}
