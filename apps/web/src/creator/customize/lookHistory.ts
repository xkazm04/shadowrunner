// Creator history (perfection-pass task 7, requirement 7.1-7.2): undo and redo over the look, pure
// and non-mutating like lookReducer. A history is a value; every function returns a new one (or
// the same one when nothing changes), so it sits in a React reducer and is compared by identity.
//
// Decisions the spec leaves open:
// - A change is coalesced into the step before it when both carry the same `group` (one slider,
//   one colour) and it lands within COALESCE_MS of the last one, so a drag is one step; `seal`
//   (pointer-up) ends the group early. A change without a group is always its own step.
// - Pushing the present again (a refused or no-op edit) changes nothing, so it is never a step.
// - `opened` (the Compare baseline) never moves: it is the look the history began with.
// - Past is capped at `limit` steps; the oldest fall off. Undo and redo end any open group, so a
//   drag that resumes after an undo starts a new step.

/** How long after the last change of a group the next one still joins its step. */
export const COALESCE_MS = 500;
export const HISTORY_LIMIT = 100;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** The value the history began with (the look as the character was opened). */
  readonly opened: T;
  readonly limit: number;
  /** The open coalescing group and when it last changed (ms); undefined once sealed. */
  readonly group?: { readonly key: string; readonly at: number };
}

export function createHistory<T>(initial: T, { limit = HISTORY_LIMIT }: { limit?: number } = {}): History<T> {
  return { past: [], present: initial, future: [], opened: initial, limit: Math.max(1, Math.floor(limit)) };
}

export interface PushOptions {
  /** Changes of one control share a key; consecutive ones within COALESCE_MS are one step. */
  group?: string;
  /** Now, in ms (the caller's clock, so this stays pure). */
  at?: number;
}

export function push<T>(h: History<T>, next: T, { group, at = 0 }: PushOptions = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  const base = { past: h.past, present: next, future: [] as readonly T[], opened: h.opened, limit: h.limit };
  const open = group === undefined ? {} : { group: { key: group, at } };
  if (group !== undefined && h.group?.key === group && at - h.group.at <= COALESCE_MS) return { ...base, ...open };
  return { ...base, past: [...h.past, h.present].slice(-h.limit), ...open };
}

/** Ends the open group (pointer-up): the next change is a new step. */
export function seal<T>(h: History<T>): History<T> {
  if (h.group === undefined) return h;
  return { past: h.past, present: h.present, future: h.future, opened: h.opened, limit: h.limit };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: prev as T, future: [h.present, ...h.future], opened: h.opened, limit: h.limit };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present].slice(-h.limit), present: next as T, future: rest, opened: h.opened, limit: h.limit };
}
