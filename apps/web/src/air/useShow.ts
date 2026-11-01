// useShow (voice-and-air task 5.2): binds the show controller (show.ts) to React and to the
// browser: /api/* through apiFetch (so `?plane=replay` sends `x-sr-plane: replay`), the monotonic
// performance clock, window timers, and a player on the stage's <audio> element.
import type { Persona, ShowScript } from "@sr/engine";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { apiFetch, type Fetcher } from "../app/plane";
import { createShow, type PlayResult, type Show, type ShowSnapshot, type VoicePlayer } from "./show";

/** A line that has not ended after this long counts as failed (a stalled stream). */
export const MAX_LINE_MS = 45_000;

/**
 * Plays URLs on one <audio> element. `ensureRunning` is the Web Audio context check
 * (useLoudness): a context that cannot run means the browser has not allowed sound yet.
 */
export function createElementPlayer(audio: HTMLAudioElement, ensureRunning: () => Promise<boolean>): VoicePlayer {
  let finish: ((result: PlayResult) => void) | undefined;
  return {
    async play(url) {
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
  /** False while the stage is not ready (assets loading); the show starts when it turns true. */
  enabled: boolean;
  fetch?: Fetcher;
}

export interface UseShow {
  snapshot: ShowSnapshot;
  post(text: string): boolean;
  /** Call from a click: resumes the audio context and lets the next lines play. */
  soundOn(): void;
}

const IDLE: ShowSnapshot = { status: "booting", chat: [], sound: "on", beat: 0 };
const idleShow: Pick<Show, "subscribe" | "snapshot"> = { subscribe: () => () => undefined, snapshot: () => IDLE };

export function useShow({ show, persona, self, audio, ensureRunning, enabled, fetch = apiFetch }: UseShowOptions): UseShow {
  const controller = useMemo(() => {
    if (audio === null) return undefined;
    return createShow({
      show,
      persona,
      self,
      fetch,
      now: () => performance.now(),
      timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(typeof h === "number" ? h : undefined) },
      player: createElementPlayer(audio, ensureRunning),
      objectUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
  }, [show, persona, self, fetch, audio, ensureRunning]);

  useEffect(() => {
    if (controller === undefined || !enabled) return undefined;
    controller.start();
    return () => controller.stop();
  }, [controller, enabled]);

  const source = controller ?? idleShow;
  const snapshot = useSyncExternalStore(source.subscribe, source.snapshot, () => IDLE);

  const post = useCallback((text: string) => controller?.post(text) ?? false, [controller]);
  const soundOn = useCallback(() => {
    void ensureRunning().then((running) => {
      if (running) controller?.soundOn();
    });
  }, [controller, ensureRunning]);

  return { snapshot, post, soundOn };
}
