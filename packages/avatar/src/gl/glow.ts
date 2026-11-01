// Glow pass (avatar-renderer task 3.4, req 1.4, 5.3). The base pass draws into a full-size scene
// target with two attachments: the colour, and the glow source (emissive layers' light, occluded
// by every layer in front). Then four full-screen draws: extract (downsample the glow source to a
// half-resolution target), horizontal blur, vertical blur (9-tap Gaussian), and the composite of
// scene + blurred glow x `palette.glow` onto the canvas.
//
// Decisions the spec leaves open:
// - Emissive layers are redrawn into the glow source by the base pass itself (a second render
//   target), so the extract is one draw and a frame costs exactly visible layers + 4 (req 7.1).
// - The glow breathes: its gain follows a slow sine (GLOW_PULSE_*) on the driver's clock. Under
//   reduced motion, or without a clock, it holds at the mean (req 5.3: the glow does not pulse).
//   Flare and glare reach the glow through the emissive layers' pose `tint`.
import type { Rgb } from "../render/frame.js";
import type { FrameClock } from "../render/types.js";
import type { Programs } from "./programs.js";

/** Glow strength on `palette.glow`. */
export const GLOW_GAIN = 1.6;
/** Glow pulse: relative amplitude and period, seconds. */
export const GLOW_PULSE_AMP = 0.12;
export const GLOW_PULSE_PERIOD_S = 4;
/** Blur tap spacing, in half-resolution texels. */
export const BLUR_SPREAD = 1.5;

interface Target {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
}

export interface GlowTargets {
  /** Full size: colour (0) and glow source (1). */
  scene: Target;
  /** Half size ping-pong pair. */
  halfA: Target;
  halfB: Target;
}

function texture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl: WebGL2RenderingContext, width: number, height: number, attachments: number): Target {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures: WebGLTexture[] = [];
  for (let i = 0; i < attachments; i += 1) {
    const t = texture(gl, width, height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    textures.push(t);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error("avatar: glow framebuffer incomplete");
  }
  return { fbo, textures, width, height };
}

/** Allocates the scene and half-resolution targets for a `width` x `height` buffer. */
export function createGlowTargets(gl: WebGL2RenderingContext, width: number, height: number): GlowTargets {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const hw = Math.max(1, Math.ceil(w / 2));
  const hh = Math.max(1, Math.ceil(h / 2));
  const targets = { scene: target(gl, w, h, 2), halfA: target(gl, hw, hh, 1), halfB: target(gl, hw, hh, 1) };
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return targets;
}

export function deleteGlowTargets(gl: WebGL2RenderingContext, targets: GlowTargets): void {
  for (const t of [targets.scene, targets.halfA, targets.halfB]) {
    gl.deleteFramebuffer(t.fbo);
    for (const tex of t.textures) gl.deleteTexture(tex);
  }
}

/** Binds the scene target with both attachments and clears it to transparent. */
export function beginScene(gl: WebGL2RenderingContext, targets: GlowTargets): void {
  const { scene } = targets;
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.viewport(0, 0, scene.width, scene.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** Glow gain for this frame: steady without a clock or under reduced motion. */
export function glowGain(clock: FrameClock | undefined): number {
  if (clock === undefined || clock.reducedMotion || !Number.isFinite(clock.t)) return GLOW_GAIN;
  return GLOW_GAIN * (1 + GLOW_PULSE_AMP * Math.sin((2 * Math.PI * clock.t) / GLOW_PULSE_PERIOD_S));
}

function fullscreen(gl: WebGL2RenderingContext, into: Target | null, width: number, height: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into === null ? null : into.fbo);
  if (into !== null) gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function bindSource(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture | undefined): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex ?? null);
}

/**
 * Extract, blur twice, composite onto the canvas (`width` x `height`). Returns the draw count (4).
 */
export function runGlow(gl: WebGL2RenderingContext, programs: Programs, targets: GlowTargets, tint: Rgb, gain: number): number {
  const { scene, halfA, halfB } = targets;
  gl.disable(gl.BLEND);
  gl.bindVertexArray(programs.quad.vao);

  gl.useProgram(programs.extract.program);
  gl.uniform1i(programs.extract.u.u_src, 0);
  bindSource(gl, 0, scene.textures[1]);
  fullscreen(gl, halfA, halfA.width, halfA.height);

  gl.useProgram(programs.blur.program);
  gl.uniform1i(programs.blur.u.u_src, 0);
  gl.uniform2f(programs.blur.u.u_step, BLUR_SPREAD / halfA.width, 0);
  bindSource(gl, 0, halfA.textures[0]);
  fullscreen(gl, halfB, halfB.width, halfB.height);
  gl.uniform2f(programs.blur.u.u_step, 0, BLUR_SPREAD / halfA.height);
  bindSource(gl, 0, halfB.textures[0]);
  fullscreen(gl, halfA, halfA.width, halfA.height);

  gl.useProgram(programs.composite.program);
  gl.uniform1i(programs.composite.u.u_scene, 0);
  gl.uniform1i(programs.composite.u.u_glow, 1);
  gl.uniform3f(programs.composite.u.u_tint, tint[0] * gain, tint[1] * gain, tint[2] * gain);
  bindSource(gl, 0, scene.textures[0]);
  bindSource(gl, 1, halfA.textures[0]);
  fullscreen(gl, null, scene.width, scene.height);

  bindSource(gl, 1, undefined);
  bindSource(gl, 0, undefined);
  gl.bindVertexArray(null);
  return 4;
}
