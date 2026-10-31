# Design: avatar-renderer

## Overview
Two halves with a pure seam between them. The **driver** is a pure state machine stepped by `dt`
that produces rig-core's `Drive`; the **renderer** turns `poseLayers(rig, look, drive)` into GL
draws. Only the renderer and the audio tap touch browser APIs, so all behaviour that can be
property-tested is in the driver.

```
packages/avatar/src/driver/state.ts      DriverState, DriverInputs, initialState(seed)
packages/avatar/src/driver/step.ts       step(state, dt, inputs) -> state (pure)
packages/avatar/src/driver/drive.ts      toDrive(state) -> Drive
packages/avatar/src/driver/rng.ts        mulberry32 seeded RNG (pure)
packages/avatar/src/audio/level.ts       attachAudio -> { level(): number, detach() }
packages/avatar/src/gl/context.ts        context creation, loss handling
packages/avatar/src/gl/programs.ts       shader sources + compile/link
packages/avatar/src/gl/layers.ts         texture upload, quad draw per LayerPose
packages/avatar/src/gl/glow.ts           half-res extract, 2-pass blur, additive composite
packages/avatar/src/gl/renderer.ts       createRenderer (WebGL2), Renderer interface
packages/avatar/src/canvas2d/renderer.ts canvas2D fallback with the same interface
packages/avatar/src/react/AvatarCanvas.tsx
packages/avatar/src/index.ts             re-exports
apps/web/bench/avatar.html (+ bench/avatar.ts)  frame-time bench, not shipped in the app bundle
```

## Contracts
```ts
import type { Rig, Look, Drive, LayerPose, Gesture } from "@sr/rig";

export type Gaze = "host" | "content" | "chat";
export interface DriverInputs {
  level: number;            // audio RMS 0..1 (0 when no audio)
  gaze: Gaze;
  gesture?: Gesture;        // edge-triggered: present only on the frame it starts
  reducedMotion: boolean;
}
export interface DriverState {
  t: number;                // seconds since start
  rng: number;              // RNG state
  nextBlinkAt: number; blinkStart?: number;
  drift: { yaw: number; pitch: number; phase: number };
  saccade: { yaw: number; pitch: number; nextAt: number };
  gazeYaw: number;          // eased toward the gaze target
  jaw: number;              // smoothed 0..1
  gesture?: { name: Gesture; startedAt: number };
}
export function initialState(seed: number): DriverState;
export function step(s: DriverState, dt: number, i: DriverInputs): DriverState;
export function toDrive(s: DriverState): Drive;

export interface RendererInfo { mode: "webgl2" | "2d"; drawCalls: number; textureUploads: number }
export interface Renderer {
  setRig(rig: Rig, assets: Record<string, ImageBitmap | HTMLImageElement>): void;
  setLook(look: Look): void;
  draw(poses: LayerPose[], look: Look): void;
  resize(width: number, height: number, dpr: number): void;
  info(): RendererInfo;
  dispose(): void;
}
export function createRenderer(canvas: HTMLCanvasElement, rig: Rig, assets: Record<string, ImageBitmap | HTMLImageElement>): Renderer;

export interface AvatarCanvasProps {
  rig: Rig; look: Look;
  assets: Record<string, ImageBitmap | HTMLImageElement>;  // keyed by Layer.file
  drive?: Drive;                       // overrides the driver (tests, screenshots)
  audio?: AudioNode | HTMLMediaElement;
  gaze?: Gaze;                         // default "host"
  gesture?: Gesture;                   // a change triggers playback
  className?: string;
}
```
`Drive` has no gaze field; the driver folds gaze, drift and saccades into `headYaw`/`headPitch`
before rig-core clamps them. Constants (blink 2–6 s, 120–180 ms; drift ±4°/±2°; saccade ≤1°
every 0.4–1.2 s; gaze targets 0/−8/+10°; jaw attack 40 ms, release 120 ms, floor 0.04) live in
`driver/state.ts` as named exports so tests import them.

## Rendering
- Vertex shader: unit quad scaled to `bbox` size, transformed by the pose's translation,
  rotation about the layer anchor, scale; projected to canvas pixels (rig width/height fit
  into the canvas with letterboxing, DPR aware).
- Fragment shader (base): premultiplied texture × opacity × tint; rim term = `smoothstep` on
  alpha gradient (sampled 4 taps) × `palette.rim` × 0.35; for `eye` layers multiply by
  `palette.eye × eyeGain`.
- Glow: emissive layers redrawn into a half-res RGBA8 FBO, horizontal then vertical 9-tap
  Gaussian, composited additively × `palette.glow` × (1 + gesture flare gain). Reduced motion
  disables the glow pulse only.
- Assets: textures created once in `setRig`; `setLook` only updates uniforms.
- Context loss: on `webglcontextlost` swap to the canvas2D renderer and keep drawing.

## Testing strategy
- fast-check over random seeds, `dt` sequences (1–50 ms) and input sequences:
  blink start gaps always in [2, 6] s; `jawOpen`, `blink` in [0, 1]; yaw/pitch within clamps;
  `reducedMotion: true` ⇒ drift and saccade components exactly 0; `step` is pure (deep-freeze).
- Jaw: constant `level = 0` ⇒ `jawOpen < 0.01` after 250 ms from any state.
- Exact-count perf: a counting WebGL2 stub (records `drawArrays`, `texImage2D`) renders
  Malakor for 120 frames ⇒ draw calls per frame = visible layers + 4; texture uploads = layer
  count total.
- Fallback: a stub returning null for `webgl2` yields `info().mode === "2d"`.
- Bench page is manual and reported in `docs/kiro-log.md`, never a CI gate.
