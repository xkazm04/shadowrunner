// The out page's playout clock (spec flashhead-live, design "Clock and sync"): the server stamps
// every frame and audio chunk with a pts on one stream clock; the page plays each at
// `pts + playoutDelay`, measured from the first pts it received, on one local clock (WebAudio's
// when it runs, the wall clock otherwise). Pure, so the sync rules are unit-tested.

export const DEFAULT_DELAY_MS = 250;
export const FRAME_MS = 40;
/** A pts this far behind the anchor means the server restarted its stream: start over. */
export const RESTART_MS = 1000;
/** A pts this far ahead of the playhead means the stream skipped (a reconnect): start over. */
export const SKIP_MS = 5000;

interface Anchor {
  /** Stream pts (ms) that plays at `at`. */
  pts: number;
  /** Local clock (s) at which `pts` was received, before the delay. */
  at: number;
}

export class StreamClock {
  private anchor: Anchor | undefined;
  readonly delayMs: number;

  constructor(delayMs = DEFAULT_DELAY_MS) {
    this.delayMs = delayMs;
  }

  get anchored(): boolean {
    return this.anchor !== undefined;
  }

  /** Called with every arriving pts: anchors on the first, and re-anchors on a restart or a skip. Returns true when it (re)anchored. */
  observe(pts: number, now: number): boolean {
    const anchor = this.anchor;
    if (anchor !== undefined) {
      const head = this.streamMs(now);
      if (pts >= anchor.pts - RESTART_MS && pts <= head + SKIP_MS) return false;
    }
    this.anchor = { pts, at: now };
    return true;
  }

  /** The local clock time (s) at which stream `pts` plays. */
  playAt(pts: number): number {
    const anchor = this.anchor;
    if (anchor === undefined) return Number.NaN;
    return anchor.at + (pts - anchor.pts) / 1000 + this.delayMs / 1000;
  }

  /** The stream pts (ms) playing at local time `now` (s). */
  streamMs(now: number): number {
    const anchor = this.anchor;
    if (anchor === undefined) return Number.NaN;
    return anchor.pts + (now - anchor.at) * 1000 - this.delayMs;
  }

  /** The local clock changed source (wall <-> audio): keep the playhead where it was. */
  rebase(oldNow: number, newNow: number): void {
    const anchor = this.anchor;
    if (anchor === undefined) return;
    this.anchor = { pts: anchor.pts, at: anchor.at + (newNow - oldNow) };
  }

  reset(): void {
    this.anchor = undefined;
  }
}

export interface Queued {
  pts: number;
}

/**
 * The frame to show at playhead `head` from a pts-sorted queue: the newest one due. Frames before
 * it are stale (returned to be released); frames after it wait.
 */
export function pickFrame<T extends Queued>(queue: readonly T[], head: number): { show: T | undefined; stale: T[]; rest: T[] } {
  let due = -1;
  for (let i = 0; i < queue.length; i += 1) {
    if ((queue[i]?.pts ?? Infinity) <= head) due = i;
    else break;
  }
  if (due < 0) return { show: undefined, stale: [], rest: [...queue] };
  return { show: queue[due], stale: queue.slice(0, due), rest: queue.slice(due + 1) };
}

/** Insert by pts (frames usually arrive in order: a push at the end). */
export function insertByPts<T extends Queued>(queue: T[], item: T): void {
  let i = queue.length;
  while (i > 0 && (queue[i - 1]?.pts ?? -Infinity) > item.pts) i -= 1;
  queue.splice(i, 0, item);
}

/**
 * Where an audio chunk starts: at its time, or, when it arrives late, now with the late part
 * skipped (so the rest stays on the clock and never drifts). Undefined when it is entirely late.
 */
export function audioStart(when: number, now: number, durationS: number): { at: number; offset: number } | undefined {
  if (when >= now) return { at: when, offset: 0 };
  const late = now - when;
  return late >= durationS ? undefined : { at: now, offset: late };
}
