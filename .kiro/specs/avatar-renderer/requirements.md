# Requirements: avatar-renderer

## Introduction
`packages/avatar` brings a Rig v1 to life in the browser: a hand-written WebGL2 2.5D renderer
that draws the per-frame `LayerPose[]` from `poseLayers` (rig-core), and a procedural driver that
produces the `Drive` each frame (blinks, drift, micro-saccades, gaze, a mouth that follows audio
loudness, gesture playback). It is the hero of every surface: the character's face is the
brightest, sharpest thing on screen. It never redefines rig types; it consumes `Rig`, `Look`,
`Drive`, `LayerPose`, `Emotion`, `Gesture` and `lookToEmotionDrive` from `packages/rig`.

## Requirement 1: WebGL2 layer renderer
**User story:** As a streamer, I want my character drawn crisply with light that matches its look, so that it reads as alive, not as stacked stickers.

#### Acceptance criteria
1. `createRenderer(canvas, rig, assets)` SHALL upload one texture per visible layer and draw one textured quad per `LayerPose`, in the order returned by `poseLayers`, with premultiplied alpha.
2. The canvas SHALL be transparent (`alpha: true, premultipliedAlpha: true`); nothing SHALL be drawn outside layer quads in the base pass.
3. A rim-light term SHALL tint layer edges with `look.palette.rim`, and `eye` layers SHALL be multiplied by `look.palette.eye` scaled by the emotion's `eyeGain` from `lookToEmotionDrive`.
4. A glow pass SHALL render emissive layers (`eye`, `crown`, `accessory`) to a half-resolution target, blur it with a separable 2-pass kernel, and add it tinted by `look.palette.glow`.
5. WHEN `rig` or `look` changes THEN the renderer SHALL update textures or uniforms without recreating the GL context.
6. `dispose()` SHALL delete every texture, buffer, framebuffer and program it created.

## Requirement 2: Fallback
**User story:** As a visitor on an old device, I want to still see the character, so that the app never shows an empty frame.

#### Acceptance criteria
1. IF `canvas.getContext("webgl2")` returns null or context creation throws THEN `createRenderer` SHALL return a canvas2D renderer with the same interface.
2. The canvas2D renderer SHALL draw the same `LayerPose[]` (position, scale, rotation, opacity) and SHALL skip rim light and glow.
3. WHEN the WebGL2 context is lost THEN the renderer SHALL switch to canvas2D for the session and SHALL report `mode: "2d"` from `renderer.info()`.

## Requirement 3: Procedural driver
**User story:** As a viewer, I want the face to blink, drift and look around naturally, so that it feels present even when silent.

#### Acceptance criteria
1. `step(state, dt, inputs): DriverState` SHALL be a pure function; `toDrive(state): Drive` SHALL map it to rig-core's `Drive`.
2. Blinks SHALL start at intervals drawn uniformly from [2, 6] s (seeded RNG in state) and SHALL last 120–180 ms.
3. Drift SHALL be a smooth low-frequency head yaw/pitch offset within ±4° / ±2°; micro-saccades SHALL add steps of at most 1° every 0.4–1.2 s.
4. `inputs.gaze` (`"host" | "content" | "chat"`) SHALL bias head yaw toward a fixed target per value (0°, −8°, +10°) with an ease of ~300 ms.
5. `inputs.gesture` SHALL start the named rig-core gesture at the current `t`; a new gesture SHALL replace a running one.
6. Every `Drive` produced SHALL keep `jawOpen` and `blink` within [0, 1] and head yaw/pitch within rig-core's clamps.

## Requirement 4: Mouth from audio
**User story:** As a streamer, I want the mouth to move with the voice, so that the co-host visibly speaks.

#### Acceptance criteria
1. `attachAudio(source: AudioNode | HTMLMediaElement)` SHALL route audio through an `AnalyserNode` and feed the RMS level of each frame to the driver as `inputs.level` in [0, 1].
2. The driver SHALL map `level` to `jawOpen` with a noise floor, an attack of ~40 ms and a release of ~120 ms.
3. WHEN no audio is attached or the level stays under the floor THEN `jawOpen` SHALL settle to 0 within 250 ms.

## Requirement 5: Reduced motion
**User story:** As a visitor who prefers reduced motion, I want a calm face, so that the app is comfortable to use.

#### Acceptance criteria
1. WHEN `inputs.reducedMotion` is true THEN drift and micro-saccades SHALL be zero.
2. Blinks and the audio-driven mouth SHALL remain active under reduced motion.
3. Gestures under reduced motion SHALL be applied as instantaneous pose changes held for the gesture's duration (cuts, no easing curves), and the glow pass SHALL not pulse.

## Requirement 6: React wrapper
**User story:** As the creator and on-air pages, I want one component, so that both surfaces render the face identically.

#### Acceptance criteria
1. `<AvatarCanvas rig look drive? audio? gaze? gesture? />` SHALL own the canvas, renderer, driver and requestAnimationFrame loop.
2. WHEN `drive` is passed THEN it SHALL override the driver output (for tests and screenshots).
3. The component SHALL read `prefers-reduced-motion` (and the shell's `data-motion` attribute) and pass it to the driver.
4. On unmount the component SHALL cancel its frame loop and dispose the renderer.

## Requirement 7: Performance budget
**User story:** As a streamer on a laptop, I want the face to stay smooth while I stream, so that it never drops frames idle.

#### Acceptance criteria
1. Each frame SHALL issue at most `visibleLayers + 4` draw calls (base quads + 2 blur passes + glow extract + composite); an exact-count test SHALL assert this against a counting GL stub.
2. Textures SHALL be uploaded once per rig, not per frame (counted by the same stub).
3. `apps/web/bench/avatar.html` SHALL render Malakor idle for 10 s and report median and p95 frame time; the target is 60 fps on an integrated GPU (reported, not gated).
