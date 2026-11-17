// The body of `createAvatarPlayer` (player.ts), with its renderer factory as a parameter so tests
// can count draws without a GL stub. Not exported from `@sr/avatar`: the public entry is
// `createAvatarPlayer`, which passes the real `createRenderer`.
//
// Decisions the spec leaves open:
// - The frame body is AvatarCanvas's (player/frame.ts), so the two move alike for one seed.
// - Timing: the loop takes only the gap between rAF timestamps (the driver clamps it); the first
//   frame after `start` has dt 0, so a stopped player resumes without a jump. `renderFrame(dt)`
//   steps the same state by `dt` outside the loop (a video at a fixed rate, tests).
// - Reduced motion "auto" reads `prefers-reduced-motion` and the nearest `data-motion` attribute
//   (the shell's, from the canvas's host element) every frame; `true` / `false` force it.
// - The host element is the canvas's parent at creation (the canvas itself with none). Visibility
//   and `data-motion` are read from it, not the canvas: the GL renderer replaces the canvas in the
//   DOM on a context loss (gl/renderer.ts), and a detached canvas never intersects the viewport.
// - The frame inputs (`AvatarPlayerInputs`, AvatarCanvas's props): `act` and `gesture` are taken by
//   the next frame only; dim, lookAt (a ref read per frame), gaze, drive, a level source and a clip
//   mouth hold until changed. A clip mouth runs through createTrackMouth on the loop's own dt; a
//   `setMouthShapes` mix wins over it while set. `setRig` hands the renderer the new rig at once
//   (skipped when nothing changed); the frame body, `mouthMode` and `layerFrames` follow it.
// - `autoSize` observes the canvas's parent (the canvas is expected to fill it, CSS 100%); with no
//   parent, or with `autoSize: false`, the caller calls `resize`.
// - Gaze is "host" (the face looks out of the frame, at the viewer) until `setGaze`.
// - After `dispose` every method is a no-op.
// - `pauseOffscreen` (perfection-pass P1, default on): the `start` loop schedules no frame while
//   the page is hidden or its host is fully outside the viewport (render/visibility.ts), and the
//   first frame back has dt 0. `renderFrame` always steps and draws (a recorder drives it). The
//   autoSize buffer's DPR is capped at MAX_DPR.
import type { Drive, Emotion, Gesture, Layer, LayerPose, Look, Rig } from "@sr/rig";
import { attachAudio, type AttachAudioOptions, type AudioLevelTap } from "../audio/level.js";
import type { LookAtPoint } from "../driver/lookAt.js";
import type { Gaze } from "../driver/state.js";
import type { CreateRendererOptions } from "../gl/renderer.js";
import { fitView, layerAffine, lookLight } from "../render/frame.js";
import type { MouthPose, MouthShapesInput } from "../mouth/state.js";
import { mouthMode, type MouthMode } from "../mouth/anchor.js";
import type { CanvasHost, FrameClock, Renderer, RigAssets } from "../render/types.js";
import { bufferDpr, isReducedMotion } from "../react/loop.js";
import { watchVisibility } from "../render/visibility.js";
import { createTrackMouth, type ClipMouth } from "../speech/drive.js";
import { createFrameBody } from "./frame.js";
import { cutoutLook } from "./cutout.js";
import type { AvatarPlayerOptions, FullAvatarPlayer, LayerFrame, LookAtRef, PlayerAudio } from "./player.js";

export type RendererFactory = (canvas: CanvasHost, rig: Rig, assets: RigAssets, options: CreateRendererOptions) => Renderer;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const clampLevel = (level: number): number => (Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0);

/** Pure: the point a `lookAt` input names this frame (a ref is read now), or undefined. */
export function resolveLookAt(lookAt: LookAtPoint | LookAtRef | undefined): LookAtPoint | undefined {
  if (lookAt === undefined) return undefined;
  if ("current" in lookAt) return lookAt.current ?? undefined;
  return lookAt;
}

const layerIndex = (rig: Rig): Map<string, Layer> => new Map(rig.layers.map((layer) => [layer.name, layer]));

export function runPlayer(canvas: HTMLCanvasElement, options: AvatarPlayerOptions, makeRenderer: RendererFactory): FullAvatarPlayer {
  const win = canvas.ownerDocument.defaultView;
  // The host element is captured now: a context loss swaps the canvas, never its parent.
  const parent = canvas.parentElement;
  const host: Element = parent ?? canvas;
  const renderer = makeRenderer(canvas, options.rig, options.assets, options.loadAsset === undefined ? {} : { loadAsset: options.loadAsset });
  const body = createFrameBody(options.seed ?? 1, options.loadAsset === undefined ? {} : { loadAsset: options.loadAsset });
  const media = options.reducedMotion === undefined || options.reducedMotion === "auto" ? win?.matchMedia?.(REDUCED_QUERY) : undefined;
  // Callers hold the look they set; the player draws it as a cutout unless `backdrop` (player.ts).
  let look: Look = cutoutLook(options.look, options.backdrop);
  let tap: AudioLevelTap | undefined;
  let override: number | (() => number) | undefined;
  let mouthInput: MouthShapesInput | undefined;
  let clip: ClipMouth | undefined;
  const trackMouth = createTrackMouth();
  let rig: Rig = options.rig;
  let assets: RigAssets = options.assets;
  let pendingAct: string | undefined;
  let dim: number | undefined;
  let lookAt: LookAtPoint | LookAtRef | undefined;
  let gaze: Gaze = "host";
  let drive: Drive | undefined;
  let mouthShown: MouthPose | undefined;
  let pendingGesture: Gesture | undefined;
  let raf: number | undefined;
  let lastNow: number | undefined;
  let disposed = false;
  // The last frame's poses and look, for `layerFrames` (read only, never fed back into a draw).
  let drawn: { poses: LayerPose[]; look: Look; mood: FrameClock["mood"] } | undefined;
  let layersByName = layerIndex(rig);

  const reducedMotion = (): boolean => {
    if (typeof options.reducedMotion === "boolean") return options.reducedMotion;
    return isReducedMotion(media?.matches ?? false, host.closest("[data-motion]")?.getAttribute("data-motion"));
  };

  const step = (dt: number): void => {
    const gesture = pendingGesture;
    pendingGesture = undefined;
    const act = pendingAct;
    pendingAct = undefined;
    const reduced = reducedMotion();
    const point = resolveLookAt(lookAt);
    // The track steps every frame (its reduced-motion ease keeps time) even under a caller's mix.
    const fromClip = trackMouth({ mouth: clip, reducedMotion: reduced, dt });
    const mouth = mouthInput ?? fromClip;
    const out = body({
      rig,
      look,
      dt,
      level: typeof override === "function" ? clampLevel(override()) : (override ?? tap?.level() ?? 0),
      gaze,
      reducedMotion: reduced,
      ...(gesture === undefined ? {} : { gesture }),
      ...(act === undefined ? {} : { act }),
      ...(point === undefined ? {} : { lookAt: point }),
      ...(drive === undefined ? {} : { drive }),
      ...(dim === undefined ? {} : { dim }),
      ...(mouth === undefined ? {} : { mouth }),
      assets,
    });
    renderer.draw(out.poses, look, out.clock);
    mouthShown = out.clock.mouth;
    drawn = { poses: out.poses, look, mood: out.clock.mood };
  };

  // The loop runs while `start`ed and its host can be seen (perfection-pass P1); `raf` is the
  // pending frame, undefined while stopped or paused.
  let running = false;
  const watch = options.pauseOffscreen === false || win === null ? undefined : watchVisibility(host, (visible) => (visible ? schedule() : unschedule()));
  function schedule(): void {
    if (!disposed && running && raf === undefined && win !== null && (watch === undefined || watch.visible())) raf = win.requestAnimationFrame(frame);
  }
  function unschedule(): void {
    if (raf !== undefined) win?.cancelAnimationFrame(raf);
    raf = undefined;
    lastNow = undefined;
  }
  function frame(now: number): void {
    raf = undefined;
    if (disposed || !running) return;
    const dt = lastNow === undefined ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    step(dt);
    schedule();
  }

  const fit = (): void => {
    if (parent === null) return;
    const box = parent.getBoundingClientRect();
    renderer.resize(Math.max(1, box.width), Math.max(1, box.height), bufferDpr(win?.devicePixelRatio));
  };
  let observer: ResizeObserver | undefined;
  if (options.autoSize !== false && parent !== null) {
    fit();
    if (typeof win?.ResizeObserver === "function") {
      observer = new win.ResizeObserver(fit);
      observer.observe(parent);
    }
  }

  const stop = (): void => {
    running = false;
    unschedule();
  };

  const player: FullAvatarPlayer = {
    setLook(next: Look): void {
      if (!disposed) look = cutoutLook(next, options.backdrop);
    },
    setEmotion(emotion: Emotion): void {
      player.setLook({ ...look, emotion });
    },
    gesture(gesture: Gesture): void {
      if (!disposed) pendingGesture = gesture;
    },
    attachAudio(source: PlayerAudio | undefined, audioOptions?: AttachAudioOptions): void {
      if (disposed) return;
      tap?.detach();
      tap = source === undefined ? undefined : attachAudio(source, audioOptions);
    },
    setLevel(level: number | undefined): void {
      if (!disposed) override = level === undefined ? undefined : clampLevel(level);
    },
    setMouthShapes(shapes, mouthOptions): void {
      if (!disposed) mouthInput = shapes === undefined ? undefined : { ...mouthOptions, shapes };
    },
    mouth(): MouthPose | undefined {
      return disposed ? undefined : mouthShown;
    },
    mouthMode(): MouthMode | undefined {
      return mouthMode(rig.mouth, rig.morph);
    },
    act(layer: string): void {
      if (!disposed) pendingAct = layer;
    },
    setDim(next: number | undefined): void {
      if (!disposed) dim = next;
    },
    setLookAt(next: LookAtPoint | LookAtRef | undefined): void {
      if (!disposed) lookAt = next;
    },
    setGaze(next: Gaze | undefined): void {
      if (!disposed) gaze = next ?? "host";
    },
    setDrive(next: Drive | undefined): void {
      if (!disposed) drive = next;
    },
    setClipMouth(next: ClipMouth | undefined): void {
      if (!disposed) clip = next;
    },
    setLevelSource(read: (() => number) | undefined): void {
      if (!disposed) override = read;
    },
    setRig(nextRig: Rig, nextAssets: RigAssets): void {
      if (disposed || (nextRig === rig && nextAssets === assets)) return;
      rig = nextRig;
      assets = nextAssets;
      layersByName = layerIndex(rig);
      renderer.setRig(rig, assets);
    },
    resize(width: number, height: number, dpr: number): void {
      if (!disposed) renderer.resize(width, height, dpr);
    },
    start(): void {
      if (disposed || running || win === null) return;
      running = true;
      schedule();
    },
    stop,
    renderFrame(dt: number): void {
      if (!disposed) step(Math.max(0, dt));
    },
    layerFrames(): LayerFrame[] {
      if (disposed || drawn === undefined) return [];
      // The renderers' own math: the undressed rig fitted into the drawing buffer, the look's brow.
      const view = fitView(rig, canvas.width, canvas.height);
      const { browY } = lookLight(rig, drawn.look, drawn.mood);
      return drawn.poses.flatMap((pose) => {
        const layer = layersByName.get(pose.name);
        return layer === undefined ? [] : [{ layer, affine: layerAffine(layer, pose, view, browY), opacity: pose.opacity }];
      });
    },
    dispose(): void {
      if (disposed) return;
      stop();
      disposed = true;
      drawn = undefined;
      mouthShown = undefined;
      tap?.detach();
      tap = undefined;
      watch?.dispose();
      observer?.disconnect();
      renderer.dispose();
    },
  };
  return player;
}
