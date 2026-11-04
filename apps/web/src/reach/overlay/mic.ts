// The overlay's microphone (spec avatar-reach, requirement 3.3): asks on load, lip-syncs the player
// to the stream (measured, never played: no echo), and falls back to a click when the browser wants
// a gesture first (permission refused, or an AudioContext that starts suspended). The browser is
// injected so the whole flow is unit-tested.
import type { AvatarPlayer } from "@sr/avatar/core";

export type MicState =
  | { kind: "starting" }
  | { kind: "running" }
  /** A click may fix it: the line shows a button. */
  | { kind: "needs-click"; reason: string }
  /** A click will not fix it: the line only says why. */
  | { kind: "failed"; reason: string };

export interface MicEnv {
  /** undefined when the page has no microphone API (an insecure origin, an old browser). */
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  createContext: () => AudioContext;
}

export const CLICK_TO_START = "Click to start listening.";
export const MIC_REFUSED = "The microphone was refused. Click to ask again, or allow it in this site's settings.";
export const MIC_MISSING = "No microphone was found.";
export const MIC_UNAVAILABLE = "This page cannot reach a microphone here (it needs https or localhost).";
export const MIC_FAILED = "The microphone could not start. Click to try again.";

export function browserMicEnv(): MicEnv {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    getUserMedia: devices?.getUserMedia === undefined ? undefined : (constraints) => devices.getUserMedia(constraints),
    createContext: () => new AudioContext(),
  };
}

function refusalOf(error: unknown): MicState {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "needs-click", reason: MIC_REFUSED };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { kind: "failed", reason: MIC_MISSING };
  return { kind: "needs-click", reason: MIC_FAILED };
}

export interface Mic {
  /** On load (`fromClick` false) and from the click-to-start button (true). */
  start(fromClick: boolean): Promise<void>;
  /** Detaches, stops the tracks and closes the context. */
  dispose(): void;
}

export function createMic(player: Pick<AvatarPlayer, "attachAudio">, env: MicEnv, onState: (state: MicState) => void): Mic {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let disposed = false;
  let attempt = 0;

  const report = (state: MicState) => {
    if (!disposed) onState(state);
  };

  async function start(fromClick: boolean): Promise<void> {
    if (disposed) return;
    const mine = ++attempt;
    report({ kind: "starting" });
    if (stream === undefined) {
      if (env.getUserMedia === undefined) return report({ kind: "failed", reason: MIC_UNAVAILABLE });
      let got: MediaStream;
      try {
        got = await env.getUserMedia({ audio: true });
      } catch (error) {
        if (mine === attempt) report(refusalOf(error));
        return;
      }
      if (disposed || mine !== attempt || stream !== undefined) {
        for (const track of got.getTracks()) track.stop();
        return;
      }
      stream = got;
    }
    context ??= env.createContext();
    if (context.state === "suspended") {
      // resume() without a user gesture stays pending: ask for the click instead of waiting on it.
      if (!fromClick) return report({ kind: "needs-click", reason: CLICK_TO_START });
      try {
        await context.resume();
      } catch {
        if (mine === attempt) report({ kind: "needs-click", reason: MIC_FAILED });
        return;
      }
      if (disposed || mine !== attempt) return;
    }
    player.attachAudio(stream, { context });
    report({ kind: "running" });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (stream !== undefined) {
      player.attachAudio(undefined);
      for (const track of stream.getTracks()) track.stop();
    }
    void context?.close().catch(() => undefined);
  }

  return { start, dispose };
}
