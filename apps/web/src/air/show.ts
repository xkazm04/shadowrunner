// The on-air show (voice-and-air task 5.2, requirements 3.4, 4.3, 4.5): the chat, one show clock and
// the beat loop pick -> reply -> voice -> play -> captions. A plain controller with injected
// fetch, clock, timers and player, so the loop is tested without a browser; useShow.ts binds it
// to React. One beat's reply and voice are fetched by beat.ts; the types and clock live in showModel.ts.
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
// - An engine error skips the beat and tries again one beat later; the second in a row kills
//   the line (stage.ts). While the line is dead nothing airs: no beats, no audience; health is
//   polled every 5 s and the show resumes where it stopped (the audience does not burst in).
//
// Never dead air (perfection-pass 5):
// - While the stage waits on a beat with no line up, `pending` names what it waits on ("reply",
//   then "voice"), but only after THINK_DELAY_MS, so a wait that ends at once (replay) never
//   flashes a thinking state. `upcoming` carries the reply as soon as it lands (its emotion shows
//   then); the reply joins the chat when its line starts, not before.
// - A visitor's message is `queued` until a pick takes it (or passes it by); the beat in flight
//   names the message it answers in `answering` until its line starts.
// - LIVE only (`prefetch`): when a line starts, the next beat is launched at once (reply, voice
//   and mouth track), so it is ready when the line ends. At most one beat is in flight. A visitor
//   message that arrives before that beat starts playing pre-empts it (aborted, its pick undone,
//   the visitor's beat launched instead and picked from the visitor's messages first), unless it
//   already answers a visitor. A discarded beat is never retried. A prefetch that fails is
//   dropped quietly and the serial path takes over when the line ends. The chat it sends is the
//   chat as it stands when it launches, the line now playing included.
import { pickMessage, initialPickState, MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, type EngineRequest, type PickState } from "@sr/engine";
import { launchBeat, requestReply, voiceFor, type BeatSource, type InFlight, type ReadyBeat } from "./beat";
import { BEAT_MS, CHAT_KEEP, createShowClock, plainMsg, showPeriod, THINK_DELAY_MS, VISITOR_NAME, type AirMsg, type Caption, type ShowDeps, type ShowSnapshot } from "./showModel";
import { HEALTH_POLL_MS, INITIAL_STAGE, stageStep, type StageEvent, type StageState } from "./stage";

export { requestVoice, VOICE_ATTEMPTS } from "./beat";
export * from "./showModel";

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
}

export function createShow(deps: ShowDeps): Show {
  const { show, persona, self, timers, player } = deps;
  const clock = createShowClock(deps.now);
  const period = showPeriod(show);
  const listeners = new Set<() => void>();
  let snap: ShowSnapshot = { status: "booting", chat: [], sound: "on", beat: 0, pending: undefined };
  let stage: StageState = INITIAL_STAGE;
  let pickState: PickState = initialPickState();
  let running = false;
  let generation = 0;
  let audienceAt = 0;
  let visitorCount = 0;
  let beatTimer: unknown;
  let audienceTimer: unknown;
  let currentUrl: string | undefined;
  /** Time spent with the line dead: the audience's schedule moves on by it. */
  let pausedMs = 0;
  let deadSince: number | undefined;
  /** The one beat in flight, and the pick state from before its pick (to undo it). */
  let inflight: InFlight | undefined;
  let pickBefore: PickState = pickState;
  /** The stage waits on `inflight` with no line up; `thinking` once THINK_DELAY_MS have passed. */
  let waiting = false;
  let thinking = false;
  let thinkTimer: unknown;

  const set = (patch: Partial<ShowSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const listener of listeners) listener();
  };

  const append = (msg: AirMsg) => set({ chat: [...snap.chat, msg].slice(-CHAT_KEEP) });

  const apply = (event: StageEvent) => {
    stage = stageStep(stage, event);
    if (stage.status !== snap.status) set({ status: stage.status });
  };

  /** pending / upcoming / answering, from the beat in flight and the wait. */
  const showWait = () => {
    const pending = waiting && thinking ? (inflight?.stage === "reply" ? "reply" : "voice") : undefined;
    const upcoming = waiting ? inflight?.reply : undefined;
    const answering = inflight?.picked?.id;
    if (pending === snap.pending && upcoming === snap.upcoming && answering === snap.answering) return;
    const next: ShowSnapshot = { ...snap, pending, ...(upcoming === undefined ? {} : { upcoming }), ...(answering === undefined ? {} : { answering }) };
    if (upcoming === undefined) delete next.upcoming;
    if (answering === undefined) delete next.answering;
    snap = next;
    for (const listener of listeners) listener();
  };

  const startWait = () => {
    waiting = true;
    thinking = false;
    timers.clear(thinkTimer);
    thinkTimer = timers.set(() => {
      thinking = true;
      showWait();
    }, THINK_DELAY_MS);
    showWait();
  };

  const endWait = () => {
    waiting = false;
    thinking = false;
    timers.clear(thinkTimer);
    showWait();
  };

  /** A visitor's message is queued while a later pick may still take it. */
  const markQueue = () => {
    let changed = false;
    const chat = snap.chat.map((m) => {
      const queued = m.fromVisitor === true && m.ts > pickState.lastPickTs;
      if (queued === (m.queued === true)) return m;
      changed = true;
      return queued ? { ...m, queued: true as const } : plainMsg(m);
    });
    if (changed) set({ chat });
  };

  /** Posts every audience message due by now; schedules the next one. */
  const postAudience = () => {
    if (!running || stage.status === "dead_line" || show.audience.length === 0) return;
    const n = show.audience.length;
    for (;;) {
      const loop = Math.floor(audienceAt / n);
      const msg = show.audience[audienceAt % n];
      if (msg === undefined) return;
      const due = loop * period + msg.ts + pausedMs;
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

  /** Drops the beat in flight (its clip URL is revoked by beat.ts) and undoes its pick. */
  const discard = () => {
    if (inflight === undefined) return;
    inflight.abort();
    inflight = undefined;
    pickState = pickBefore;
    markQueue();
    showWait();
  };

  const source = (gen: number): BeatSource => ({
    reply: async (req, signal) => (deps.local === undefined ? requestReply(deps.fetch, req, signal) : deps.local.reply(req)),
    voice: async (line, signal) => {
      if (deps.local !== undefined) {
        const url = deps.local.recording(line);
        return url === undefined ? undefined : { url, owned: false };
      }
      const blob = await voiceFor(deps.fetch, line, persona, signal);
      if (blob === undefined || signal.aborted) return undefined;
      const url = deps.objectUrl(blob);
      deps.analyse?.(url, line);
      return { url, owned: true };
    },
    revokeUrl: (url) => deps.revokeUrl(url),
    changed: () => {
      if (gen === generation) showWait();
    },
  });

  /** Picks and launches the next beat; `visitorFirst` picks among the visitor's messages first. */
  const launch = (gen: number, visitorFirst = false) => {
    const ctx = { self, now: clock.read() };
    const visitors = visitorFirst ? pickMessage(snap.chat.filter((m) => m.fromVisitor === true), pickState, ctx) : undefined;
    const { picked, state } = visitors?.picked !== undefined ? visitors : pickMessage(snap.chat, pickState, ctx);
    pickBefore = pickState;
    pickState = state;
    const req: EngineRequest = {
      characterId: show.characterId,
      persona,
      chat: snap.chat.slice(-MAX_CHAT_MESSAGES).map(plainMsg),
      beat: snap.beat,
      ...(picked === undefined ? {} : { pickedId: picked.id }),
    };
    inflight = launchBeat(req, picked, stage.status === "speaking", source(gen));
    markQueue();
    showWait();
  };

  const schedule = (ms: number, gen: number) => {
    timers.clear(beatTimer);
    beatTimer = timers.set(() => {
      if (gen === generation) void runBeat(gen);
    }, ms);
  };

  /** Asks /api/health; on air again when it answers, else polls again in HEALTH_POLL_MS. */
  const checkHealth = async (gen: number): Promise<void> => {
    const ok = await deps.health().catch(() => false);
    if (gen !== generation) return;
    const was = stage.status;
    apply({ kind: "health", ok });
    if (stage.status === "dead_line") {
      if (was !== "dead_line") goDark();
      pollHealth(gen);
      return;
    }
    if (was === "booting" || was === "dead_line") {
      if (deadSince !== undefined) pausedMs += clock.read() - deadSince;
      deadSince = undefined;
      postAudience();
      schedule(0, gen);
    }
  };

  /** The next health read, HEALTH_POLL_MS from now (only while the line is dead). */
  const pollHealth = (gen: number) => {
    timers.clear(beatTimer);
    beatTimer = timers.set(() => {
      if (gen === generation) void checkHealth(gen);
    }, HEALTH_POLL_MS);
  };

  /** The line died: stop the voice, the beats and the audience. */
  const goDark = () => {
    deadSince = clock.read();
    timers.clear(beatTimer);
    timers.clear(audienceTimer);
    player.stop();
    release();
    discard();
    endWait();
  };

  /** The beat that `gen` started is still the current one and the line is up. */
  const live = (gen: number) => gen === generation && stage.status !== "dead_line";

  /** The stage is free: wait on the beat in flight (launching one if none is), then air it. */
  const runBeat = async (gen: number): Promise<void> => {
    apply({ kind: "line", speaking: false });
    if (inflight === undefined) launch(gen);
    startWait();
    for (;;) {
      const flight = inflight;
      if (flight === undefined) return;
      const outcome = await flight.outcome;
      if (!live(gen)) return;
      if (inflight !== flight) continue; // pre-empted by a visitor: wait on its replacement
      inflight = undefined;
      if (outcome.kind === "ready") {
        endWait();
        await airLine(gen, outcome.ready);
        return;
      }
      if (outcome.kind === "aborted") return;
      if (flight.prefetched) {
        // A failed prefetch is dropped quietly: the serial path asks again now.
        pickState = pickBefore;
        launch(gen);
        continue;
      }
      endWait();
      markQueue();
      apply({ kind: "engine", ok: false });
      if (stage.status === "dead_line") {
        // The engine failed twice: give it a poll interval before asking health.
        goDark();
        pollHealth(gen);
      } else {
        schedule(BEAT_MS, gen);
      }
      return;
    }
  };

  /** Puts a ready beat on air: chat, caption, the next beat's prefetch, then the audio. */
  const airLine = async (gen: number, ready: ReadyBeat): Promise<void> => {
    const { beat, reply, url } = ready;
    apply({ kind: "engine", ok: true });
    const answered = reply.answeredId === undefined ? undefined : snap.chat.find((m) => m.id === reply.answeredId);
    append({ id: `r${beat}`, user: self, text: reply.line, ts: clock.stamp() });
    const caption = (voiced: boolean): Caption => ({ beat, line: reply.line, reply, voiced, ...(answered === undefined ? {} : { answered: plainMsg(answered) }) });
    set({ beat: beat + 1 });
    release();
    if (ready.owned) currentUrl = url;
    const voiced = url !== undefined && snap.sound === "on";
    set({ caption: caption(voiced) });
    apply({ kind: "line", speaking: true });
    if (deps.prefetch === true && inflight === undefined) launch(gen);
    if (url === undefined) {
      schedule(BEAT_MS, gen);
      return;
    }
    const startedAt = deps.now();
    const result = voiced ? await player.play(url, reply.line) : "blocked";
    if (!live(gen)) return;
    if (result === "ended") {
      apply({ kind: "line", speaking: false });
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
    now: () => clock.read(),
    start() {
      if (running) return;
      running = true;
      generation += 1;
      stage = INITIAL_STAGE;
      set({ status: stage.status });
      void checkHealth(generation);
    },
    stop() {
      running = false;
      generation += 1;
      timers.clear(beatTimer);
      timers.clear(audienceTimer);
      player.stop();
      release();
      discard();
      endWait();
    },
    post(text) {
      const clean = text.trim().slice(0, MAX_CHAT_CHARS);
      if (clean.length === 0) return false;
      visitorCount += 1;
      append({ id: `v${visitorCount}`, user: VISITOR_NAME, text: clean, ts: clock.stamp(), fromVisitor: true, queued: true });
      // LIVE: a beat in flight that does not answer a visitor gives way to the visitor's beat.
      if (deps.prefetch === true && running && stage.status !== "dead_line" && inflight !== undefined && inflight.picked?.fromVisitor !== true) {
        discard();
        launch(generation, true);
      }
      return true;
    },
    soundOn() {
      set({ sound: "on" });
    },
  };
}
