// The daemon-lost state table (landing requirement 7; design.md "Daemon state machine").
//   online -> folding (health lost) -> dark (after the fold) -> relighting (health back) -> online
// `transition` is the table itself: pure, no clock. `createDaemon` drives it with injected timers
// (tests use fake ones); reduced motion collapses the timed states into instant switches.
// The per-light schedules (who goes out when, who relights when) are pure too: the components
// write them as CSS delays, so one table times the whole choreography.
import type { Motion } from "../app/theme";

export type DaemonState = "online" | "folding" | "dark" | "relighting";

export type DaemonEvent =
  /** A health reading: the engine is unreachable (or the replay sample says so), or it is back. */
  | { kind: "health"; lost: boolean }
  /** The current timed state has run its course. */
  | { kind: "settle" };

export const DAEMON_STATES: readonly DaemonState[] = ["online", "folding", "dark", "relighting"];

/** The picture folds to a dot. */
export const FOLD_MS = 600;
/** Lights go out one by one, this far apart (the spiral first, then the gourds right to left). */
export const OUT_STEP_MS = 140;
/** How long one light takes to die. */
export const OUT_FADE_MS = 900;
/** The relight sweep, left to right: this far apart, each light taking RELIGHT_FADE_MS. */
export const RELIGHT_STEP_MS = 140;
export const RELIGHT_FADE_MS = 450;

const TABLE: Readonly<Record<DaemonState, { lost: DaemonState; back: DaemonState; settle: DaemonState }>> = {
  online: { lost: "folding", back: "online", settle: "online" },
  folding: { lost: "folding", back: "relighting", settle: "dark" },
  dark: { lost: "dark", back: "relighting", settle: "dark" },
  relighting: { lost: "folding", back: "relighting", settle: "online" },
};

/** Pure: the table. Losing health always enters `folding`; nothing reaches `dark` any other way. */
export function transition(state: DaemonState, event: DaemonEvent): DaemonState {
  const row = TABLE[state];
  if (event.kind === "settle") return row.settle;
  return event.lost ? row.lost : row.back;
}

/** Pure: the states that end on their own (after `dwellMs`). */
export function isTimed(state: DaemonState): boolean {
  return state === "folding" || state === "relighting";
}

/** Pure: the broadcast is down (lamp OFF AIR, the clock counts dead air). */
export function isLost(state: DaemonState): boolean {
  return state === "folding" || state === "dark";
}

/** Pure: a timed state run to its end (reduced motion: the instant switch). */
export function settleAll(state: DaemonState): DaemonState {
  let s = state;
  while (isTimed(s)) s = transition(s, { kind: "settle" });
  return s;
}

/** Pure: how long the relight sweep over `lights` lights takes, the last light's fade included. */
export function relightMs(lights: number): number {
  return Math.max(0, lights - 1) * RELIGHT_STEP_MS + RELIGHT_FADE_MS;
}

/** Pure: how long a timed state lasts with `lights` lights; undefined for a state that holds. */
export function dwellMs(state: DaemonState, lights: number): number | undefined {
  if (state === "folding") return FOLD_MS;
  if (state === "relighting") return relightMs(lights);
  return undefined;
}

/**
 * Pure: when light `position` changes after `state` is entered, in ms. Position 0 is the spiral
 * pumpkin (leftmost), 1..lights-1 the gourds left to right. Going dark: the spiral, then the gourds
 * right to left. Relighting: a sweep left to right. Reduced motion, and the other states: at once.
 */
export function lightDelayMs(state: DaemonState, position: number, lights: number, motion: Motion = "full"): number {
  if (motion === "reduced" || position < 0 || position >= lights) return 0;
  if (state === "dark") return (position === 0 ? 0 : lights - position) * OUT_STEP_MS;
  if (state === "relighting") return position * RELIGHT_STEP_MS;
  return 0;
}

/** Pure: how long one light takes to change in `state` (dying in dark, relighting otherwise). */
export function fadeMs(state: DaemonState): number {
  return state === "dark" ? OUT_FADE_MS : RELIGHT_FADE_MS;
}

/** Pure: when "IT IS STILL LOOKING" appears after `dark` is entered: once the last light is out. */
export function stareDelayMs(lights: number, motion: Motion = "full"): number {
  return motion === "reduced" ? 0 : Math.max(0, lights - 1) * OUT_STEP_MS + OUT_FADE_MS;
}

export interface Timers {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface DaemonDriver {
  readonly state: DaemonState;
  /** Feed a health reading. Repeating the current one changes nothing (a fold is not restarted). */
  health(lost: boolean, motion: Motion): void;
  dispose(): void;
}

const browserTimers: Timers = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/**
 * The table on a clock. Starts `online`; `onChange` hears every state it enters, in order (so a
 * reduced-motion switch reports the timed state it passes through, then where it lands).
 */
export function createDaemon(
  onChange: (state: DaemonState) => void,
  lights: number,
  timers: Timers = browserTimers,
): DaemonDriver {
  let state: DaemonState = "online";
  let timer: number | undefined;
  let disposed = false;

  const enter = (next: DaemonState, motion: Motion) => {
    if (disposed || next === state) return;
    state = next;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    onChange(state);
    if (!isTimed(state)) return;
    if (motion === "reduced") {
      enter(transition(state, { kind: "settle" }), motion);
      return;
    }
    timer = timers.setTimeout(() => {
      timer = undefined;
      enter(transition(state, { kind: "settle" }), motion);
    }, dwellMs(state, lights) ?? 0);
  };

  return {
    get state() {
      return state;
    },
    health(lost, motion) {
      const next = transition(state, { kind: "health", lost });
      // Motion turned off mid-transition: land at once.
      if (next === state && motion === "reduced" && isTimed(state)) {
        enter(transition(state, { kind: "settle" }), motion);
        return;
      }
      enter(next, motion);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}
