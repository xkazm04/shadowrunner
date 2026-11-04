// <AvatarCanvas> (avatar-renderer req 6, 5.3): owns the canvas, renderer, driver and the
// requestAnimationFrame loop, so the creator and the on-air stage render the face identically.
//
// Decisions the spec leaves open:
// - The component renders a <div> (with `className`) and creates its <canvas> inside it, filling
//   it. The renderer may swap that canvas for a fresh one when WebGL2 is lost (a WebGL canvas
//   cannot give a 2D context), and React never owns the canvas node, so the swap is safe. The div
//   takes its size from `className`; the drawing buffer follows it (ResizeObserver, x DPR).
// - Timing is the driver's clock (react/loop.ts): the rAF timestamps only give the gap
//   between frames, which `step` clamps; blinks, gestures and the glow pulse run on driver `t`.
// - `gesture` triggers on every change to a defined value (including the first render); playing
//   the same gesture again needs the prop to change (e.g. through undefined).
// - The driver is seeded with `seed` (default 1), so two mounts with one seed move alike.
// - `lookAt` (costume 9) is read every frame, like the other props. It takes a point or a ref
//   holding one, so a page can steer the gaze from a pointer handler without a React render per
//   move (the landing's torch); a ref holding null or undefined means no point.
// - Mood crossfade (character-control "Moods"): when `look.emotion` changes, the drive carries
//   `mood: { from: previous, mix }` with mix rising 0 -> 1 over MOOD_FADE_S of driver time; under
//   reduced motion the change is instant (no `mood`). A change mid-fade starts a new fade from the
//   emotion it was fading to. A `drive` prop passes through untouched.
// - `dim` (stage LINE DEAD) is eased on the browser gap between frames and handed to the renderer
//   in the frame clock; both renderers apply it per layer (render/frame.ts `dimGain`).
// - `loadAsset` (character-control): region maps and face patches missing from `assets` are
//   loaded through it on first need (render/assets.ts); read once, at mount.
// - The frame body (driver step, mood fade, dressed rig, dim) is player/frame.ts, shared with the
//   React-free player (spec avatar-reach); `moodFader` is re-exported from here as before.
import type { Drive, Gesture, Look, Rig } from "@sr/rig";
import { useEffect, useRef, type ReactElement } from "react";
import { attachAudio, type AudioLevelTap } from "../audio/level.js";
import type { LookAtPoint } from "../driver/lookAt.js";
import type { Gaze } from "../driver/state.js";
import { createRenderer } from "../gl/renderer.js";
import { createFrameBody } from "../player/frame.js";
import type { AssetLoader } from "../render/assets.js";
import type { RigAssets } from "../render/types.js";
import { isReducedMotion } from "./loop.js";

export { moodFader } from "../player/frame.js";

/** A mutable holder of the look-at point, e.g. React's `useRef<LookAtPoint | null>(null)`. */
export interface LookAtRef {
  readonly current: LookAtPoint | null | undefined;
}

/** Pure: the point a `lookAt` prop names this frame (a ref is read now), or undefined. */
export function resolveLookAt(lookAt: LookAtPoint | LookAtRef | undefined): LookAtPoint | undefined {
  if (lookAt === undefined) return undefined;
  if ("current" in lookAt) return lookAt.current ?? undefined;
  return lookAt;
}

export interface AvatarCanvasProps {
  rig: Rig;
  look: Look;
  /** Keyed by `Layer.file`. */
  assets: RigAssets;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  audio?: AudioNode | HTMLMediaElement;
  /** Default "host". */
  gaze?: Gaze;
  /** A change triggers playback. */
  gesture?: Gesture;
  className?: string;
  /** Driver RNG seed; default 1. */
  seed?: number;
  /**
   * Look toward this point, normalised view space ([-1, 1] per axis, centre 0, y down; see
   * driver/lookAt.ts), or a ref holding it. Absent: behaviour is unchanged (costume 9).
   */
  lookAt?: LookAtPoint | LookAtRef;
  /** Loads a rig file missing from `assets` (a region map, a face patch) on first need. */
  loadAsset?: AssetLoader;
  /**
   * Eyes-only dim, 0..1, read every frame (default 0: the face lit as today). Every layer but an
   * emissive eye falls toward a hint of its light; the eyes keep theirs. It eases over about a
   * second (`easeDim`) and is instant under reduced motion.
   */
  dim?: number;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function AvatarCanvas(props: AvatarCanvasProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const tapRef = useRef<AudioLevelTap | null>(null);
  const pendingGesture = useRef<Gesture | undefined>(undefined);

  useEffect(() => {
    latest.current = props;
  });

  // Mount: canvas, renderer, frame loop. Unmount: cancel the loop, dispose, remove the canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    if (win === null) return undefined;
    const canvas = doc.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const first = latest.current;
    const renderer = createRenderer(canvas, first.rig, first.assets, first.loadAsset === undefined ? {} : { loadAsset: first.loadAsset });
    let shown = { rig: first.rig, assets: first.assets };

    const resize = (): void => {
      const box = host.getBoundingClientRect();
      renderer.resize(Math.max(1, box.width), Math.max(1, box.height), win.devicePixelRatio || 1);
    };
    resize();
    const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(resize) : undefined;
    observer?.observe(host);

    const media = typeof win.matchMedia === "function" ? win.matchMedia(REDUCED_QUERY) : undefined;
    const body = createFrameBody(first.seed ?? 1);
    let lastNow: number | undefined;
    let raf = 0;
    let alive = true;

    const frame = (now: number): void => {
      if (!alive) return;
      const p = latest.current;
      if (p.rig !== shown.rig || p.assets !== shown.assets) {
        renderer.setRig(p.rig, p.assets);
        shown = { rig: p.rig, assets: p.assets };
      }
      const reducedMotion = isReducedMotion(media?.matches ?? false, host.closest("[data-motion]")?.getAttribute("data-motion"));
      const gesture = pendingGesture.current;
      pendingGesture.current = undefined;
      const lookAt = resolveLookAt(p.lookAt);
      const dt = lastNow === undefined ? 0 : (now - lastNow) / 1000;
      lastNow = now;
      const out = body({
        rig: p.rig,
        look: p.look,
        dt,
        level: tapRef.current?.level() ?? 0,
        gaze: p.gaze ?? "host",
        reducedMotion,
        ...(gesture === undefined ? {} : { gesture }),
        ...(lookAt === undefined ? {} : { lookAt }),
        ...(p.drive === undefined ? {} : { drive: p.drive }),
        ...(p.dim === undefined ? {} : { dim: p.dim }),
      });
      renderer.draw(out.poses, p.look, out.clock);
      raf = win.requestAnimationFrame(frame);
    };
    raf = win.requestAnimationFrame(frame);

    return () => {
      alive = false;
      win.cancelAnimationFrame(raf);
      observer?.disconnect();
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);

  // Audio: tap the source while it is set.
  useEffect(() => {
    if (props.audio === undefined) return undefined;
    const tap = attachAudio(props.audio);
    tapRef.current = tap;
    return () => {
      tap.detach();
      if (tapRef.current === tap) tapRef.current = null;
    };
  }, [props.audio]);

  // Gesture: edge-triggered on change; the next frame starts it at the driver's t.
  useEffect(() => {
    if (props.gesture !== undefined) pendingGesture.current = props.gesture;
  }, [props.gesture]);

  return <div ref={hostRef} className={props.className} data-avatar="" />;
}
