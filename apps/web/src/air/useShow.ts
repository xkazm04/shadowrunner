// useShow (voice-and-air tasks 5.2, 6): binds the show controller (show.ts) to React and to the
// browser: /api/* through apiFetch (so `?plane=replay` sends `x-sr-plane: replay`), /api/health
// for the dead line, the monotonic performance clock, window timers, and a player on the stage's
// <audio> element.
import type { Persona, ShowScript } from "@sr/engine";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { apiFetch, fetchHealth, type Fetcher } from "../app/plane";
import { trackForClip } from "./mouthTrack";
import type { LocalScript } from "./sheetShow";
import { createShow, type PlayResult, type Show, type ShowSnapshot, type VoicePlayer } from "./show";

/** A line that has not ended after this long counts as failed (a stalled stream). */
export const MAX_LINE_MS = 45_000;

/** The line is up when health answers and names an engine that is not offline. */
export async function lineHealthy(fetch: Fetcher): Promise<boolean> {
  const health = await fetchHealth(fetch);
  return health !== undefined && health.engine !== "offline";
}

/**
 * Plays URLs on one <audio> element. `ensureRunning` is the Web Audio context check
 * (useLoudness): a context that cannot run means the browser has not allowed sound yet. Each line's
 * mouth track is started with its text as the line starts (`analyse`, mouthTrack.ts), so the
 * stage's reader (useClipMouth) finds it made with the words.
 */
export function createElementPlayer(audio: HTMLAudioElement, ensureRunning: () => Promise<boolean>, analyse: (url: string, text?: string) => unknown = trackForClip): VoicePlayer {
  let finish: ((result: PlayResult) => void) | undefined;
  return {
    async play(url, text) {
      analyse(url, text);
      finish?.("error");
      if (!(await ensureRunning())) return "blocked";
      return new Promise<PlayResult>((resolve) => {
        const stall = window.setTimeout(() => done("error"), MAX_LINE_MS);
        const done = (result: PlayResult) => {
          window.clearTimeout(stall);
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          if (finish === done) finish = undefined;
          resolve(result);
        };
        const onEnded = () => done("ended");
        const onError = () => done("error");
        finish = done;
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        audio.src = url;
        audio.play().catch((err: unknown) => done(err instanceof DOMException && err.name === "NotAllowedError" ? "blocked" : "error"));
      });
    },
    stop() {
      audio.pause();
      finish?.("error");
    },
  };
}

export interface UseShowOptions {
  show: ShowScript;
  persona: Persona;
  self: string;
  audio: HTMLAudioElement | null;
  ensureRunning: () => Promise<boolean>;
  fetch?: Fetcher;
  /** C4: a sheet show on replay runs in the browser (sheetShow.ts). */
  local?: LocalScript;
  /** perfection-pass 5.4: fetch the next beat while a line plays (the live plane only). */
  prefetch?: boolean;
}

export interface UseShow {
  snapshot: ShowSnapshot;
  /** Now on the show clock (chat stamps' clock). */
  now(): number;
  post(text: string): boolean;
  /** Call from a click: resumes the audio context and lets the next lines play. */
  soundOn(): void;
}

const IDLE: ShowSnapshot = { status: "booting", chat: [], sound: "on", beat: 0, pending: undefined };
const idleShow: Pick<Show, "subscribe" | "snapshot"> = { subscribe: () => () => undefined, snapshot: () => IDLE };

/** The show starts once the stage's <audio> element exists; the face may still be loading. */
export function useShow({ show, persona, self, audio, ensureRunning, fetch = apiFetch, local, prefetch = false }: UseShowOptions): UseShow {
  const controller = useMemo(() => {
    if (audio === null) return undefined;
    return createShow({
      show,
      persona,
      self,
      fetch,
      health: () => lineHealthy(fetch),
      now: () => performance.now(),
      timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(typeof h === "number" ? h : undefined) },
      player: createElementPlayer(audio, ensureRunning),
      objectUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
      ...(local === undefined ? {} : { local }),
      // A sheet show on replay never prefetches (nothing to wait on); a prefetched clip's mouth track starts as it lands.
      prefetch: prefetch && local === undefined,
      analyse: trackForClip,
    });
  }, [show, persona, self, fetch, audio, ensureRunning, local, prefetch]);

  useEffect(() => {
    if (controller === undefined) return undefined;
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const source = controller ?? idleShow;
  const snapshot = useSyncExternalStore(source.subscribe, source.snapshot, () => IDLE);

  const post = useCallback((text: string) => controller?.post(text) ?? false, [controller]);
  const soundOn = useCallback(() => {
    void ensureRunning().then((running) => {
      if (running) controller?.soundOn();
    });
  }, [controller, ensureRunning]);

  const now = useCallback(() => controller?.now() ?? 0, [controller]);

  return { snapshot, now, post, soundOn };
}
