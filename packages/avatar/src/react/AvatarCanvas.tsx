// <AvatarCanvas> (avatar-renderer req 6, 5.3): owns the canvas, renderer, driver and the
// requestAnimationFrame loop, so the creator and the on-air stage render the face identically.
//
// Decisions the spec leaves open:
// - The component renders a <div> (with `className`) and creates its <canvas> inside it, filling
//   it. The renderer may swap that canvas for a fresh one when WebGL2 is lost (a WebGL canvas
//   cannot give a 2D context), and React never owns the canvas node, so the swap is safe. The div
//   takes its size from `className`; the drawing buffer follows it (ResizeObserver, x DPR capped
//   at MAX_DPR, react/loop.ts).
// - `pauseOffscreen` (perfection-pass P1, default on): while the page is hidden or the face is
//   fully outside the viewport (render/visibility.ts) no frame is scheduled, so nothing steps or
//   draws; the first frame back has dt 0, so the driver does not jump.
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
// - Lip-sync (perfection-pass task 4): `mouth` (a clip's track and clock) reaches the frame body as
//   its `mouth` input each frame (speech/drive.ts); `level` (a page's own reading) wins over the tap.
// - The frame body (driver step, mood fade, dressed rig, dim) is player/frame.ts, shared with the
//   React-free player (spec avatar-reach); `moodFader` is re-exported from here as before.
import type { Drive, Gesture, Look, Rig } from "@sr/rig";
import { useEffect, useRef, type ReactElement } from "react";
import { attachAudio, type AudioLevelTap } from "../audio/level.js";
import type { LookAtPoint } from "../driver/lookAt.js";
import type { Gaze } from "../driver/state.js";
import { createRenderer } from "../gl/renderer.js";
import type { MouthShapesInput } from "../mouth/state.js";
import { createFrameBody } from "../player/frame.js";
import type { AssetLoader } from "../render/assets.js";
import type { RigAssets } from "../render/types.js";
import { watchVisibility } from "../render/visibility.js";
import { createTrackMouth, type ClipMouth } from "../speech/drive.js";
import { bufferDpr, isReducedMotion } from "./loop.js";

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

/** The frame body's `mouth` key for a track frame's input (none: the level drive). */
const mouthInput = (mouth: MouthShapesInput | undefined): { mouth?: MouthShapesInput } => (mouth === undefined ? {} : { mouth });

export interface AvatarCanvasProps {
  rig: Rig;
  look: Look;
  /** Keyed by `Layer.file`. */
  assets: RigAssets;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  audio?: AudioNode | HTMLMediaElement;
  /**
   * The speech level 0..1, read every frame; wins over `audio` (perfection-pass 4.4: a page that
   * already taps its voice, the stage, hands its reading here instead of a second analyser).
   */
  level?: () => number;
  /**
   * A clip's mouth track on the clip's clock (perfection-pass task 4): while set, a rig whose
   * `mouthMode` is "drawn" or "warp" shapes its mouth (and opens its jaw) from the track; other
   * rigs keep the level drive. Under reduced motion one soft speaking shape (speech/drive.ts).
   */
  mouth?: ClipMouth | undefined;
  /** Default "host". */
  gaze?: Gaze;
  /** A change triggers playback. */
  gesture?: Gesture;
  /**
   * A signature act (tiger L1): each new `n` plays that layer's act once, from the next frame
   * (`n` lets the same layer play again). Absent: none.
   */
  act?: { layer: string; n: number };
  className?: string;
  /** Driver RNG seed; default 1. */
  seed?: number;
  /**
   * Stop stepping and drawing while the page is hidden or the face is fully outside the viewport,
   * resuming without a time jump (default true; read once, at mount).
   */
  pauseOffscreen?: boolean;
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
  const pendingAct = useRef<string | undefined>(undefined);

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
      renderer.resize(Math.max(1, box.width), Math.max(1, box.height), bufferDpr(win.devicePixelRatio));
    };
    resize();
    const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(resize) : undefined;
    observer?.observe(host);

    const media = typeof win.matchMedia === "function" ? win.matchMedia(REDUCED_QUERY) : undefined;
    const body = createFrameBody(first.seed ?? 1, first.loadAsset === undefined ? {} : { loadAsset: first.loadAsset });
    const trackMouth = createTrackMouth();
    let lastNow: number | undefined;
    let raf: number | undefined;
    let alive = true;
    // Paused (perfection-pass P1): no frame is scheduled; the first frame back has dt 0.
    const schedule = (): void => {
      if (alive && raf === undefined) raf = win.requestAnimationFrame(frame);
    };
    const watch =
      first.pauseOffscreen === false
        ? undefined
        : watchVisibility(host, (visible) => {
            if (visible) return schedule();
            if (raf !== undefined) win.cancelAnimationFrame(raf);
            raf = undefined;
            lastNow = undefined;
          });

    const frame = (now: number): void => {
      raf = undefined;
      if (!alive) return;
      const p = latest.current;
      if (p.rig !== shown.rig || p.assets !== shown.assets) {
        renderer.setRig(p.rig, p.assets);
        shown = { rig: p.rig, assets: p.assets };
      }
      const reducedMotion = isReducedMotion(media?.matches ?? false, host.closest("[data-motion]")?.getAttribute("data-motion"));
      const gesture = pendingGesture.current;
      pendingGesture.current = undefined;
      const act = pendingAct.current;
      pendingAct.current = undefined;
      const lookAt = resolveLookAt(p.lookAt);
      const dt = lastNow === undefined ? 0 : (now - lastNow) / 1000;
      lastNow = now;
      const out = body({
        rig: p.rig,
        look: p.look,
        dt,
        level: p.level?.() ?? tapRef.current?.level() ?? 0,
        gaze: p.gaze ?? "host",
        reducedMotion,
        ...(gesture === undefined ? {} : { gesture }),
        ...(act === undefined ? {} : { act }),
        ...(lookAt === undefined ? {} : { lookAt }),
        ...(p.drive === undefined ? {} : { drive: p.drive }),
        ...(p.dim === undefined ? {} : { dim: p.dim }),
        ...mouthInput(trackMouth({ mouth: p.mouth, reducedMotion, dt })),
        assets: p.assets,
      });
      renderer.draw(out.poses, p.look, out.clock);
      if (watch === undefined || watch.visible()) schedule();
    };
    schedule();

    return () => {
      alive = false;
      if (raf !== undefined) win.cancelAnimationFrame(raf);
      watch?.dispose();
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

  // Act: edge-triggered on a new `n`; the next frame starts it at the driver's t.
  const actLayer = props.act?.layer;
  const actN = props.act?.n;
  useEffect(() => {
    if (actLayer !== undefined && actN !== undefined) pendingAct.current = actLayer;
  }, [actLayer, actN]);

  return <div ref={hostRef} className={props.className} data-avatar="" />;
}
