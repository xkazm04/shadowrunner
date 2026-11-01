// Which chat message the character answers next (voice-and-air design.md, "Picker"). Pure: the
// caller owns the state and passes the clock in.
import type { ChatMsg } from "./types.js";

/** Recency is exp(-age / RECENCY_TAU_MS): 1 for a message posted now, 1/e after 20 s. */
export const RECENCY_TAU_MS = 20_000;
export const VISITOR_BONUS = 0.5;
export const QUESTION_BONUS = 0.3;
export const NEW_USER_BONUS = 0.3;

/** What the picker remembers between beats. Treat as immutable; pickMessage returns a new one. */
export interface PickState {
  /** `ts` of the last picked message; only newer messages are candidates. */
  readonly lastPickTs: number;
  /** Users who have been answered at least once. */
  readonly pickedUsers: ReadonlySet<string>;
}

export interface PickContext {
  /** The character's own chat name; its messages are never picked. */
  readonly self: string;
  /** Epoch milliseconds, the same clock as `ChatMsg.ts`. */
  readonly now: number;
}

export interface PickResult {
  /** Omitted when there is no candidate: the character delivers a segment or monologue line. */
  picked?: ChatMsg;
  state: PickState;
}

export function initialPickState(): PickState {
  return { lastPickTs: Number.NEGATIVE_INFINITY, pickedUsers: new Set() };
}

function score(msg: ChatMsg, state: PickState, now: number): number {
  const age = Math.max(0, now - msg.ts);
  let s = Math.exp(-age / RECENCY_TAU_MS);
  if (msg.fromVisitor) s += VISITOR_BONUS;
  if (msg.text.includes("?")) s += QUESTION_BONUS;
  if (!state.pickedUsers.has(msg.user)) s += NEW_USER_BONUS;
  return s;
}

/**
 * Picks at most one message: newer than the last pick, not from the character, highest score;
 * ties go to the earliest `ts`, then to the earliest in `msgs`. Never picks a message twice,
 * because the returned state moves `lastPickTs` to the picked message's `ts`.
 */
export function pickMessage(msgs: readonly ChatMsg[], state: PickState, ctx: PickContext): PickResult {
  let best: { msg: ChatMsg; score: number } | undefined;
  for (const msg of msgs) {
    if (msg.user === ctx.self || !(msg.ts > state.lastPickTs)) continue;
    const s = score(msg, state, ctx.now);
    if (best === undefined || s > best.score || (s === best.score && msg.ts < best.msg.ts)) {
      best = { msg, score: s };
    }
  }
  if (best === undefined) return { state };
  const picked = best.msg;
  return {
    picked,
    state: { lastPickTs: picked.ts, pickedUsers: new Set([...state.pickedUsers, picked.user]) },
  };
}
