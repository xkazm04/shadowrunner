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
//   (the shell's) every frame, exactly like AvatarCanvas; `true` / `false` force it.
// - `autoSize` observes the canvas's parent (the canvas is expected to fill it, CSS 100%); with no
//   parent, or with `autoSize: false`, the caller calls `resize`.
// - Gaze is "host" (the face looks out of the frame, at the viewer), as AvatarCanvas's default.
// - After `dispose` every method is a no-op.
import type { Emotion, Gesture, LayerPose, Look, Rig } from "@sr/rig";
import { attachAudio, type AttachAudioOptions, type AudioLevelTap } from "../audio/level.js";
import type { CreateRendererOptions } from "../gl/renderer.js";
import { fitView, layerAffine, lookLight } from "../render/frame.js";
import type { MouthPose, MouthShapesInput } from "../mouth/state.js";
import type { CanvasHost, Renderer, RigAssets } from "../render/types.js";
import { isReducedMotion } from "../react/loop.js";
import { createFrameBody } from "./frame.js";
import { cutoutLook } from "./cutout.js";
import type { AvatarPlayer, AvatarPlayerOptions, LayerFrame, PlayerAudio } from "./player.js";

export type RendererFactory = (canvas: CanvasHost, rig: Rig, assets: RigAssets, options: CreateRendererOptions) => Renderer;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const clampLevel = (level: number): number => (Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0);

export function runPlayer(canvas: HTMLCanvasElement, options: AvatarPlayerOptions, makeRenderer: RendererFactory): AvatarPlayer {
  const win = canvas.ownerDocument.defaultView;
  const renderer = makeRenderer(canvas, options.rig, options.assets, options.loadAsset === undefined ? {} : { loadAsset: options.loadAsset });
  const body = createFrameBody(options.seed ?? 1);
  const media = options.reducedMotion === undefined || options.reducedMotion === "auto" ? win?.matchMedia?.(REDUCED_QUERY) : undefined;
  // Callers hold the look they set; the player draws it as a cutout unless `backdrop` (player.ts).
  let look: Look = cutoutLook(options.look, options.backdrop);
  let tap: AudioLevelTap | undefined;
  let override: number | undefined;
  let mouthInput: MouthShapesInput | undefined;
  let mouthShown: MouthPose | undefined;
  let pendingGesture: Gesture | undefined;
  let raf: number | undefined;
  let lastNow: number | undefined;
  let disposed = false;
  // The last frame's poses and look, for `layerFrames` (read only, never fed back into a draw).
  let drawn: { poses: LayerPose[]; look: Look } | undefined;
  const layersByName = new Map(options.rig.layers.map((layer) => [layer.name, layer]));

  const reducedMotion = (): boolean => {
    if (typeof options.reducedMotion === "boolean") return options.reducedMotion;
    return isReducedMotion(media?.matches ?? false, canvas.closest("[data-motion]")?.getAttribute("data-motion"));
  };

  const step = (dt: number): void => {
    const gesture = pendingGesture;
    pendingGesture = undefined;
    const out = body({
      rig: options.rig,
      look,
      dt,
      level: override ?? tap?.level() ?? 0,
      gaze: "host",
      reducedMotion: reducedMotion(),
      ...(gesture === undefined ? {} : { gesture }),
      ...(mouthInput === undefined ? {} : { mouth: mouthInput }),
    });
    renderer.draw(out.poses, look, out.clock);
    mouthShown = out.clock.mouth;
    drawn = { poses: out.poses, look };
  };

  const frame = (now: number): void => {
    if (disposed || raf === undefined || win === null) return;
    const dt = lastNow === undefined ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    step(dt);
    raf = win.requestAnimationFrame(frame);
  };

  const parent = canvas.parentElement;
  const fit = (): void => {
    if (parent === null) return;
    const box = parent.getBoundingClientRect();
    renderer.resize(Math.max(1, box.width), Math.max(1, box.height), win?.devicePixelRatio || 1);
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
    if (raf !== undefined) win?.cancelAnimationFrame(raf);
    raf = undefined;
    lastNow = undefined;
  };

  const player: AvatarPlayer = {
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
    resize(width: number, height: number, dpr: number): void {
      if (!disposed) renderer.resize(width, height, dpr);
    },
    start(): void {
      if (disposed || raf !== undefined || win === null) return;
      raf = win.requestAnimationFrame(frame);
    },
    stop,
    renderFrame(dt: number): void {
      if (!disposed) step(Math.max(0, dt));
    },
    layerFrames(): LayerFrame[] {
      if (disposed || drawn === undefined) return [];
      // The renderers' own math: the undressed rig fitted into the drawing buffer, the look's brow.
      const view = fitView(options.rig, canvas.width, canvas.height);
      const { browY } = lookLight(options.rig, drawn.look);
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
      observer?.disconnect();
      renderer.dispose();
    },
  };
  return player;
}
