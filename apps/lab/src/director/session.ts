// One run's event pipeline, shared by live runs and replays: stamps each event with the run clock,
// records it to timeline.jsonl, sends it to the page, and keeps what metrics need (turn arrivals,
// first utterance per turn, page-reported audio starts).
import type { DirectorMessage, PageMessage, TimelineEvent } from "../contract.js";
import type { RunObservations } from "./metrics.js";
import type { TimelineWriter } from "./timeline.js";

export interface Clock {
  /** Milliseconds since `reset()`. */
  now(): number;
  reset(): void;
  sleep(ms: number): Promise<void>;
}

export function realClock(): Clock {
  let t0 = performance.now();
  return {
    now: () => performance.now() - t0,
    reset: () => {
      t0 = performance.now();
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
  };
}

/** A TimelineEvent before the session stamps its `t`. */
export type Unstamped = TimelineEvent extends infer E ? (E extends TimelineEvent ? Omit<E, "t"> : never) : never;

/** Mark emitted when turn n's control output starts (see `emit`). */
export const PLAY_MARK = /^play:(\d+)$/;
export const playMark = (turn: number): string => `play:${turn}`;

const AUDIO_START_TIMEOUT_MS = 30_000;
const TAIL_MS = 1000;

export class Session {
  readonly clock: Clock;
  readonly turnArrivals = new Map<number, number>();
  readonly firstUtterance = new Map<number, string>();
  readonly audioStarts = new Map<string, number>();
  readonly fps: number[] = [];
  dropped = 0;
  sceneOps = 0;
  renderBackend: string | undefined;
  readonly #send: (message: DirectorMessage) => void;
  readonly #writer: TimelineWriter;
  readonly #startWaiters = new Map<string, () => void>();
  /** Latest turn whose chat arrived, and latest turn whose output started (`play:<n>`). */
  #arrived = 0;
  #playing: number | undefined;
  #lastAudio: { id: string; durationMs: number } | undefined;

  constructor(send: (message: DirectorMessage) => void, writer: TimelineWriter, clock: Clock) {
    this.#send = send;
    this.#writer = writer;
    this.clock = clock;
  }

  /** Stamps (replacing any `t`), records and sends one event; returns it as recorded. */
  emit(event: Unstamped | TimelineEvent): TimelineEvent {
    const stamped: TimelineEvent = { ...event, t: Math.round(this.clock.now()) };
    if (stamped.kind === "turn") {
      this.#arrived = stamped.turn;
      this.turnArrivals.set(stamped.turn, stamped.t);
    } else if (stamped.kind === "mark") {
      // Turns queue behind each other: `play:<n>` marks when turn n's control output begins, so
      // its audio is attributed to it and not to a later chat message that already arrived.
      const play = PLAY_MARK.exec(stamped.name);
      if (play?.[1] !== undefined) this.#playing = Number(play[1]);
    } else if (stamped.kind === "audio") {
      const turn = this.#playing ?? this.#arrived;
      if (!this.firstUtterance.has(turn)) this.firstUtterance.set(turn, stamped.id);
      this.#lastAudio = { id: stamped.id, durationMs: stamped.durationMs };
    } else if (stamped.kind === "scene") {
      this.sceneOps += 1;
    }
    this.#writer.write(stamped);
    this.#send({ type: "event", event: stamped });
    return stamped;
  }

  /** PCM first (the page needs it before the audio event), then the audio event. */
  audio(id: string, sampleRate: number, pcm: Buffer, pcmRef: string, durationMs: number): void {
    this.#send({ type: "pcm", id, sampleRate, pcmBase64: pcm.toString("base64") });
    this.emit({ kind: "audio", id, sampleRate, pcmRef, durationMs });
  }

  /** Feed every page message here. */
  onPage(message: PageMessage): void {
    if (message.type === "audioStarted") {
      if (!this.audioStarts.has(message.id)) this.audioStarts.set(message.id, this.clock.now());
      this.#startWaiters.get(message.id)?.();
      this.#startWaiters.delete(message.id);
    } else if (message.type === "frameStats") {
      this.fps.push(...message.fps);
      this.dropped += message.dropped;
    } else if (message.type === "ready") {
      this.renderBackend = message.renderBackend;
    }
  }

  /** Waits until the last utterance has started and played out, plus a short tail. */
  async drain(): Promise<void> {
    const last = this.#lastAudio;
    if (last === undefined) return this.clock.sleep(TAIL_MS);
    if (!this.audioStarts.has(last.id)) {
      await Promise.race([
        new Promise<void>((resolve) => this.#startWaiters.set(last.id, resolve)),
        this.clock.sleep(AUDIO_START_TIMEOUT_MS),
      ]);
    }
    const started = this.audioStarts.get(last.id) ?? this.clock.now();
    await this.clock.sleep(started + last.durationMs + TAIL_MS - this.clock.now());
  }

  observations(base: Pick<RunObservations, "runId" | "config">, durationMs: number): RunObservations {
    return {
      ...base,
      durationMs,
      turnArrivals: this.turnArrivals,
      firstUtterance: this.firstUtterance,
      audioStarts: this.audioStarts,
      fps: this.fps,
      dropped: this.dropped,
      sceneOps: this.sceneOps,
      ...(this.renderBackend === undefined ? {} : { renderBackend: this.renderBackend }),
    };
  }
}
