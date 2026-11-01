// The chat's typewriter on the replay plane (landing requirement 6.2): plays chatScript's pure
// machine on a clock. `stepChat` after `delayOf` ms, forever, until stopped. Motion only: with
// reduced motion the strip shows chatScript's static twin and this chunk is never loaded.
import { delayOf, stepChat, type ChatState } from "../chatScript";

export interface ChatTimers {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const browserTimers: ChatTimers = {
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/**
 * Plays from `from`, reporting every new state. The first step waits `firstDelay` when given
 * (the arrival pause), else `delayOf(from)` (resuming mid-script). Returns the stop function.
 */
export function playChat(
  from: ChatState,
  onState: (state: ChatState) => void,
  firstDelay?: number,
  timers: ChatTimers = browserTimers,
): () => void {
  let state = from;
  let stopped = false;
  let timer = 0;
  const schedule = (ms: number) => {
    timer = timers.setTimeout(() => {
      if (stopped) return;
      state = stepChat(state);
      onState(state);
      schedule(delayOf(state));
    }, ms);
  };
  schedule(firstDelay ?? delayOf(state));
  return () => {
    stopped = true;
    timers.clearTimeout(timer);
  };
}
