// The stage's voice loudness (voice-and-air task 5.1, requirement 4.4): the line's <audio> element
// runs through one Web Audio graph, an AnalyserNode reads its RMS, and an attack/release follower
// turns that into jawOpen (0..1, attack 30 ms, release 90 ms, design.md).
//
// Decisions the spec leaves open:
// - The face's jaw is moved by @sr/avatar's driver, which owns the jaw curve (avatar-renderer task 7
//   adds the speech gain there). So this hook does not override the driver's Drive (that would
//   freeze blinks and drift); it owns the graph and its one analyser tap, hands the avatar that
//   tap's speech level (<AvatarCanvas level>, perfection-pass 4.4: no second analyser), and gives
//   the stage the jawOpen reading of the same tap for the VOICE tally on the lamp, so "the mouth
//   moves" and "the tally is lit" come from one signal. A line with a mouth track (mouthTrack.ts)
//   shapes the mouth from the track; the level still lights the tally and the stage.
// - The element is wrapped once (createMediaElementSource is once per element) in one
//   AudioContext, connected to the speakers, and the context is closed a tick after unmount (a
//   StrictMode remount within the tick keeps it). A context that is not running (no user gesture yet)
//   is "blocked": the stage then shows captions only until the visitor turns the sound on.
import { attachAudio, type AudioLevelTap } from "@sr/avatar";
import { useCallback, useEffect, useMemo, useRef } from "react";

/** Time to cover 95% of the way to a higher level, ms (design.md). */
export const JAW_ATTACK_MS = 30;
/** Time to cover 95% of the way to a lower level, ms (design.md). */
export const JAW_RELEASE_MS = 90;
/** Share of the way an ease covers in its stated time. */
const EASE_SHARE = 0.95;
/** Speech RMS this high or more opens the jaw fully. Normal speech measures 0.05-0.3. */
export const RMS_FULL = 0.3;
/** RMS under this is room noise: the jaw stays shut. */
export const RMS_FLOOR = 0.02;

/** The jaw target for one RMS reading: 0 under the floor, linear to 1 at RMS_FULL. */
export function jawTarget(rms: number): number {
  if (!(rms > RMS_FLOOR)) return 0;
  return Math.min(1, (rms - RMS_FLOOR) / (RMS_FULL - RMS_FLOOR));
}

/**
 * One step of the attack/release follower: from `prev` toward `target` over `dtMs`. Rising uses
 * the attack time, falling the release time; non-finite or negative `dtMs` is no time.
 */
export function followJaw(prev: number, target: number, dtMs: number): number {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const ease = target > prev ? JAW_ATTACK_MS : JAW_RELEASE_MS;
  const share = 1 - Math.pow(1 - EASE_SHARE, dt / ease);
  const next = prev + (target - prev) * share;
  return Math.min(1, Math.max(0, next));
}

/** The level source the follower reads: an analyser tap in the browser, a fake in tests. */
export type LevelReader = Pick<AudioLevelTap, "level">;

/** A jawOpen meter over a level reader. `read(nowMs)` advances the follower to `nowMs`. */
export function createJawMeter(reader: LevelReader): { read(nowMs: number): number } {
  let jaw = 0;
  let last: number | undefined;
  return {
    read(nowMs) {
      const dt = last === undefined ? 0 : nowMs - last;
      last = nowMs;
      jaw = followJaw(jaw, jawTarget(reader.level()), dt);
      return jaw;
    },
  };
}

export interface Loudness {
  /**
   * The voice's speech level now (0..1, @sr/avatar's `speechLevel` of the one analyser tap), for
   * <AvatarCanvas level>; 0 before the graph exists.
   */
  level(): number;
  /** jawOpen now (0..1); 0 before the graph exists. */
  jawOpen(nowMs: number): number;
  /** Resumes the context; true when it runs (sound can play). */
  ensureRunning(): Promise<boolean>;
}

type ContextFactory = () => AudioContext | undefined;

const browserContext: ContextFactory = () => (typeof AudioContext === "function" ? new AudioContext() : undefined);

/** How long a resume may take before the context counts as blocked. */
export const RESUME_WAIT_MS = 300;

interface Route {
  context: AudioContext;
  node: AudioNode;
  /** A pending close (unmount); a remount of the same element within the tick cancels it. */
  closing?: ReturnType<typeof setTimeout>;
}

/** One graph per element for the element's lifetime (StrictMode mounts effects twice). */
const routes = new WeakMap<HTMLMediaElement, Route>();

function routeOf(element: HTMLMediaElement, makeContext: ContextFactory): Route | undefined {
  const known = routes.get(element);
  if (known !== undefined) {
    clearTimeout(known.closing);
    delete known.closing;
    return known;
  }
  const context = makeContext();
  if (context === undefined) return undefined;
  let node: AudioNode;
  try {
    node = context.createMediaElementSource(element);
  } catch {
    // Wrapped once already by a context now closed: no graph (the element cannot be re-wrapped).
    void context.close().catch(() => undefined);
    return undefined;
  }
  node.connect(context.destination);
  const route: Route = { context, node };
  routes.set(element, route);
  return route;
}

/** Closes the element's context a tick after unmount, unless it is mounted again first (StrictMode). */
function release(element: HTMLMediaElement, route: Route): void {
  clearTimeout(route.closing);
  route.closing = setTimeout(() => {
    routes.delete(element);
    route.node.disconnect();
    void route.context.close().catch(() => undefined);
  }, 0);
}

/**
 * Wires `element` into one AudioContext with one analyser tap while mounted (perfection-pass 4.4:
 * the face reads `level`, the tally and the lights `jawOpen`, all from that tap); the context is
 * closed on unmount.
 */
export function useLoudness(element: HTMLAudioElement | null, makeContext: ContextFactory = browserContext): Loudness {
  const graph = useRef<{ context: AudioContext; tap: LevelReader; meter: { read(nowMs: number): number } } | null>(null);

  useEffect(() => {
    if (element === null) return undefined;
    const route = routeOf(element, makeContext);
    if (route === undefined) return undefined;
    const tap = attachAudio(route.node);
    graph.current = { context: route.context, tap, meter: createJawMeter(tap) };
    return () => {
      tap.detach();
      graph.current = null;
      release(element, route);
    };
  }, [element, makeContext]);

  const level = useCallback(() => graph.current?.tap.level() ?? 0, []);
  const jawOpen = useCallback((nowMs: number) => graph.current?.meter.read(nowMs) ?? 0, []);

  const ensureRunning = useCallback(async () => {
    const context = graph.current?.context;
    if (context === undefined) return false;
    if (context.state === "running") return true;
    const waited = new Promise<void>((resolve) => setTimeout(resolve, RESUME_WAIT_MS));
    await Promise.race([context.resume().catch(() => undefined), waited]);
    // Read again: resume() changes the state after the narrowing above.
    return (context.state as AudioContextState) === "running";
  }, []);

  return useMemo(() => ({ level, jawOpen, ensureRunning }), [level, jawOpen, ensureRunning]);
}
