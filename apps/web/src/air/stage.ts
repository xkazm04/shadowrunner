// The stage state machine (voice-and-air design.md "Stage state machine", requirement 5.1):
// booting -> on_air <-> speaking -> on_air; any state -> dead_line when /api/health fails or the
// engine errors twice in a row; dead_line -> on_air only when health answers again. Pure: the
// show controller (show.ts) feeds it events and acts on the status it returns.
import type { StageStatus } from "./show";

/** Consecutive engine errors that kill the line. */
export const DEAD_AFTER_ENGINE_ERRORS = 2;
/** Health is polled this often while the line is dead (design.md). */
export const HEALTH_POLL_MS = 5_000;

export interface StageState {
  status: StageStatus;
  /** Engine errors since the last good reply. */
  engineErrors: number;
}

export type StageEvent =
  /** /api/health answered (`ok`: a valid body whose engine is not offline) or failed. */
  | { kind: "health"; ok: boolean }
  /** One engine reply arrived (`ok`) or failed. */
  | { kind: "engine"; ok: boolean }
  /** A line started (`speaking`) or ended. */
  | { kind: "line"; speaking: boolean };

export const INITIAL_STAGE: StageState = { status: "booting", engineErrors: 0 };

export function stageStep(state: StageState, event: StageEvent): StageState {
  switch (event.kind) {
    case "health":
      if (!event.ok) return { status: "dead_line", engineErrors: state.engineErrors };
      if (state.status === "booting" || state.status === "dead_line") return { status: "on_air", engineErrors: 0 };
      return state;
    case "engine": {
      if (state.status === "dead_line" || state.status === "booting") return state;
      if (event.ok) return state.engineErrors === 0 ? state : { ...state, engineErrors: 0 };
      const errors = state.engineErrors + 1;
      return errors >= DEAD_AFTER_ENGINE_ERRORS ? { status: "dead_line", engineErrors: errors } : { status: "on_air", engineErrors: errors };
    }
    case "line":
      if (event.speaking) return state.status === "on_air" ? { ...state, status: "speaking" } : state;
      return state.status === "speaking" ? { ...state, status: "on_air" } : state;
  }
}
