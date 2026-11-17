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
//
// challenge-2026-11-17 air/A: the rules above are a pure reducer (showMachine.ts showStep); this
// file is the interpreter that runs its effects (launch, air, play, timers, health, the audience)
// and feeds what happens back as events. The chat marks are one derivation (chatMarks.ts): the
// snapshot carries them, and a visitor's message the picks went by is marked `passed`.
import { pickMessage, MAX_CHAT_CHARS, MAX_CHAT_MESSAGES, type EngineRequest } from "@sr/engine";
import { launchBeat, requestReply, voiceFor, type BeatSource, type InFlight, type ReadyBeat } from "./beat";
import { chatMarks, keepAnswered, sameMarks } from "./chatMarks";
import { initialShow, showStep, type ShowEffect, type ShowEvent, type ShowState } from "./showMachine";
import { CHAT_KEEP, createShowClock, plainMsg, showPeriod, THINK_DELAY_MS, VISITOR_NAME, type AirMsg, type Show, type ShowDeps, type ShowSnapshot } from "./showModel";
import { HEALTH_POLL_MS } from "./stage";

export { requestVoice, VOICE_ATTEMPTS } from "./beat";
export * from "./showModel";

export function createShow(deps: ShowDeps): Show {
  const { show, persona, self, timers, player } = deps;
  const clock = createShowClock(deps.now);
  const period = showPeriod(show);
  const listeners = new Set<() => void>();
  let snap: ShowSnapshot = { status: "booting", chat: [], sound: "on", beat: 0, pending: undefined };
  let state: ShowState = initialShow(deps.prefetch === true);
  /** Each launched beat's handle, and a landed beat waiting for the stage. */
  const flights = new Map<number, InFlight>();
  const landed = new Map<number, ReadyBeat>();
  let answered: ReadonlySet<string> = new Set();
  let audienceAt = 0;
  let visitorCount = 0;
  let beatTimer: unknown;
  let audienceTimer: unknown;
  let thinkTimer: unknown;
  let currentUrl: string | undefined;
  const queue: ShowEvent[] = [];
  let busy = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const set = (patch: Partial<ShowSnapshot>) => {
    snap = { ...snap, ...patch };
    notify();
  };

  /** Status, wait, answering and the chat marks, derived from the state and the beat in flight. */
  const sync = () => {
    const inflight = state.flight === undefined ? undefined : flights.get(state.flight.id);
    const status = state.stage.status;
    const pending = state.wait === "thinking" ? (inflight?.stage === "reply" ? "reply" : "voice") : undefined;
    const upcoming = state.wait === "none" ? undefined : inflight?.reply;
    const answering = inflight?.picked?.id;
    answered = keepAnswered(answered, snap.chat);
    const speakingAnsweredId = status === "speaking" ? snap.caption?.answered?.id : undefined;
    const marks = chatMarks(snap.chat, {
      lastPickTs: state.pickState.lastPickTs,
      answeredIds: answered,
      ...(answering === undefined ? {} : { answeringId: answering }),
      ...(speakingAnsweredId === undefined ? {} : { speakingAnsweredId }),
    });
    let requeued = false;
    const chat = snap.chat.map((m) => {
      const queued = marks[m.id] === "queued";
      if (queued === (m.queued === true)) return m;
      requeued = true;
      return queued ? { ...m, queued: true as const } : plainMsg(m);
    });
    const same = status === snap.status && pending === snap.pending && upcoming === snap.upcoming && answering === snap.answering && !requeued && sameMarks(snap.marks, marks);
    if (same) return;
    const next: ShowSnapshot = { ...snap, status, pending, chat, marks, ...(upcoming === undefined ? {} : { upcoming }), ...(answering === undefined ? {} : { answering }) };
    if (upcoming === undefined) delete next.upcoming;
    if (answering === undefined) delete next.answering;
    snap = next;
    notify();
  };

  const append = (msg: AirMsg) => {
    set({ chat: [...snap.chat, msg].slice(-CHAT_KEEP) });
    sync();
  };

  /** Steps the reducer and runs its effects; events raised meanwhile wait their turn. */
  const dispatch = (event: ShowEvent) => {
    queue.push(event);
    if (busy) return;
    busy = true;
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const out = showStep(state, next);
      state = out.state;
      for (const fx of out.effects) run(fx);
    }
    busy = false;
    sync();
  };

  /** Posts every audience message due by now; schedules the next one. */
  const postAudience = () => {
    if (!state.running || state.stage.status === "dead_line" || show.audience.length === 0) return;
    const n = show.audience.length;
    for (;;) {
      const loop = Math.floor(audienceAt / n);
      const msg = show.audience[audienceAt % n];
      if (msg === undefined) return;
      const due = loop * period + msg.ts + state.pausedMs;
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
      if (gen === state.generation) sync();
    },
  });

  /** Picks (the visitor's messages first when asked) and launches one beat. */
  const launch = (id: number, visitorFirst: boolean, prefetched: boolean) => {
    const ctx = { self, now: clock.read() };
    const visitors = visitorFirst ? pickMessage(snap.chat.filter((m) => m.fromVisitor === true), state.pickState, ctx) : undefined;
    const { picked, state: pickState } = visitors?.picked !== undefined ? visitors : pickMessage(snap.chat, state.pickState, ctx);
    const req: EngineRequest = {
      characterId: show.characterId,
      persona,
      chat: snap.chat.slice(-MAX_CHAT_MESSAGES).map(plainMsg),
      beat: snap.beat,
      ...(picked === undefined ? {} : { pickedId: picked.id }),
    };
    const gen = state.generation;
    const flight = launchBeat(req, picked, prefetched, source(gen));
    flights.set(id, flight);
    void flight.outcome.then((outcome) => {
      if (!flights.has(id)) return;
      if (outcome.kind === "ready") landed.set(id, outcome.ready);
      dispatch({ kind: "outcome", gen, flight: id, result: outcome.kind, at: clock.read() });
    });
    dispatch({ kind: "picked", flight: id, visitor: picked?.fromVisitor === true, pickState });
  };

  const drop = (id: number) => {
    flights.delete(id);
    landed.delete(id);
  };

  /** Puts a ready beat on air (chat, caption), then plays it and reports the line's end. */
  const air = async (id: number): Promise<void> => {
    const ready = landed.get(id);
    drop(id);
    if (ready === undefined) return;
    const gen = state.generation;
    const { beat, reply, url } = ready;
    const asked = reply.answeredId === undefined ? undefined : snap.chat.find((m) => m.id === reply.answeredId);
    append({ id: `r${beat}`, user: self, text: reply.line, ts: clock.stamp() });
    if (asked !== undefined) answered = keepAnswered(answered, snap.chat, asked.id);
    release();
    if (ready.owned) currentUrl = url;
    const voiced = url !== undefined && snap.sound === "on";
    set({ beat: beat + 1, caption: { beat, line: reply.line, reply, voiced, ...(asked === undefined ? {} : { answered: plainMsg(asked) }) } });
    if (url === undefined) {
      dispatch({ kind: "lineEnded", gen, result: "none", elapsed: 0, at: clock.read() });
      return;
    }
    const startedAt = deps.now();
    const result = voiced ? await player.play(url, reply.line) : "blocked";
    dispatch({ kind: "lineEnded", gen, result, elapsed: deps.now() - startedAt, at: clock.read() });
  };

  /** Asks /api/health and reports the answer. */
  const checkHealth = async (gen: number): Promise<void> => {
    const ok = await deps.health().catch(() => false);
    dispatch({ kind: "health", gen, ok, at: clock.read() });
  };

  const run = (fx: ShowEffect): void => {
    const gen = state.generation;
    switch (fx.kind) {
      case "checkHealth":
        return void checkHealth(gen);
      case "pollHealth":
        timers.clear(beatTimer);
        beatTimer = timers.set(() => void checkHealth(gen), HEALTH_POLL_MS);
        return;
      case "postAudience":
        return postAudience();
      case "stopAudience":
        return timers.clear(audienceTimer);
      case "launchBeat":
        return launch(fx.flight, fx.visitorFirst, fx.prefetched);
      case "abort":
        flights.get(fx.flight)?.abort();
        return drop(fx.flight);
      case "air":
        return void air(fx.flight);
      case "schedule":
        timers.clear(beatTimer);
        beatTimer = timers.set(() => dispatch({ kind: "beatDue", gen, at: clock.read() }), fx.ms);
        return;
      case "clearBeat":
        return timers.clear(beatTimer);
      case "startThink":
        timers.clear(thinkTimer);
        thinkTimer = timers.set(() => dispatch({ kind: "thinkElapsed", gen }), THINK_DELAY_MS);
        return;
      case "clearThink":
        return timers.clear(thinkTimer);
      case "stopPlayer":
        return player.stop();
      case "revoke":
        return release();
      case "unvoice":
        if (snap.caption !== undefined) set({ caption: { ...snap.caption, voiced: false }, ...(fx.blocked ? { sound: "blocked" as const } : {}) });
        return;
    }
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
    start: () => dispatch({ kind: "start" }),
    stop: () => dispatch({ kind: "stop" }),
    post(text) {
      const clean = text.trim().slice(0, MAX_CHAT_CHARS);
      if (clean.length === 0) return false;
      visitorCount += 1;
      append({ id: `v${visitorCount}`, user: VISITOR_NAME, text: clean, ts: clock.stamp(), fromVisitor: true, queued: true });
      dispatch({ kind: "post" });
      return true;
    },
    soundOn() {
      set({ sound: "on" });
    },
  };
}
