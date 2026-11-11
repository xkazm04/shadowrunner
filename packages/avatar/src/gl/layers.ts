// Layer textures and the base pass (avatar-renderer task 3.3, req 1.1-1.3, 7.2): one texture per
// visible rig layer, uploaded once in `setRig` with premultiplied alpha; one textured quad per
// `LayerPose`, in the order `poseLayers` returns, blended premultiplied-over. Character-control
// adds the recolour uniforms (render/recolour.ts), the region map on unit 1, and face patches.
// Face-control adds an eye's closed-lid art (drawn over the eye at `LayerPose.closed`) and the iris,
// drawn with the iris program clipped by its eye's socket masks (gl/iris.ts).
// Perfection-pass P1: the per-pose path allocates nothing in steady state: `u_m` is one reused
// Float32Array (MATRIX, filled by render/frame.ts `layerMat3`), gains and rims are scalars, and a
// pose's quads are drawn as they are found (drawPoseQuads) instead of collected into a list. A
// later change keeps that: no array or object literal per pose or per quad on this path.
// Perfection-pass V2 (gl/turn.ts): while the frame's turn is active, a layer on the head is drawn
// as the shared vertex grid with its bend (u_turnK) and, unless it is an eye, iris or emissive, the
// turn's light; every other quad, and every quad of a frame without a turn, is drawn as before.
// Companion-lanes (gl/morph.ts): while the frame has a morph draw, the morph layer's quads are drawn
// with the morph program (its uniforms bound once per pose, u_draw per quad); without one, as before.
import { EMISSIVE_KINDS as RIG_EMISSIVE_KINDS, isEmissive, type ExpressionFamily, type Layer, type LayerKind, type LayerPose, type Rig } from "@sr/rig";
import { dimGain, layerMat3, type LookLight, type Rgb, type View } from "../render/frame.js";
import { keepsArtColour, mapRect, needsMap, type LayerRecolour } from "../render/recolour.js";
import type { RigAssets } from "../render/types.js";
import { clearIrisUnits, irisClipOf, setIrisClip } from "./iris.js";
import type { MorphDraw } from "./morph.js";
import type { Programs } from "./programs.js";
import { uploadImage, type GlTexture, type TextureStore } from "./textures.js";
import { bindStrip, litByTurn, setTurnFrame, setTurnLayer, type TurnFrame } from "./turn.js";
import { setWarp, setWarpDraw, type WarpLayer, type WarpPlan } from "./warp.js";

/**
 * Kinds whose light feeds the glow pass (req 1.4) unless the layer says otherwise: a layer's own
 * `emissive` (cast-forge task 12 follow-up) wins (`isEmissive`). An eye that is not emissive takes
 * no eye multiply; the eye light's recolour (character-control) reaches it all the same.
 */
export const EMISSIVE_KINDS: ReadonlySet<LayerKind> = RIG_EMISSIVE_KINDS;
/**
 * Kinds without a rim: their edges are cuts inside the face, not silhouette (the jaw's top edge is
 * the mouth seam across the teeth; eyes sit in their sockets), so a rim there draws a seam line.
 */
export const NO_RIM_KINDS: ReadonlySet<LayerKind> = new Set(["jaw", "eye"]);

export interface LayerTexture extends GlTexture {
  layer: Layer;
}

/**
 * Uploads one texture per layer the rig draws (`visible !== false`) that has an asset; a layer
 * hidden by a look keeps its texture, so looks never upload. Returns the textures by layer name.
 * A region map already in the assets is uploaded with its layer (into `store`).
 */
export function uploadLayers(gl: WebGL2RenderingContext, rig: Rig, assets: RigAssets, store?: TextureStore): Map<string, LayerTexture> {
  const textures = new Map<string, LayerTexture>();
  for (const layer of rig.layers) {
    const image = assets[layer.file];
    if (layer.visible === false || image === undefined || textures.has(layer.name)) continue;
    textures.set(layer.name, { layer, ...uploadImage(gl, image, "layer") });
    if (layer.regions !== undefined && assets[layer.regions.map] !== undefined) store?.get(layer.regions.map, "map");
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return textures;
}

/**
 * Whether this frame's base pass writes light into the glow source: some pose draws an emissive
 * layer at an opacity above 0 (perfection-pass P1; a frame without one skips the glow blurs).
 */
export function emitsGlow(textures: ReadonlyMap<string, LayerTexture>, poses: readonly LayerPose[]): boolean {
  for (let i = 0; i < poses.length; i += 1) {
    const pose = poses[i];
    const entry = pose === undefined ? undefined : textures.get(pose.name);
    if (pose !== undefined && entry !== undefined && isEmissive(entry.layer) && !(pose.opacity <= 0)) return true;
  }
  return false;
}

export function deleteLayers(gl: WebGL2RenderingContext, textures: Map<string, LayerTexture>): void {
  for (const { texture } of textures.values()) gl.deleteTexture(texture);
  textures.clear();
}

/** What the base pass needs beyond the poses: the look's light and per-layer recolours. */
export interface LayerLighting {
  light: LookLight;
  /** By layer name; absent = drawn as painted (u_recolour 0). */
  recolours: ReadonlyMap<string, LayerRecolour>;
  store: TextureStore;
  /** Eyes-only dim 0..1 (frame.ts `dimGain`); absent = 0. */
  dim?: number;
  /** The frame's depth turn (gl/turn.ts `planTurn`); absent or inactive = none. */
  turn?: TurnFrame;
  /** The frame's morph keys (gl/morph.ts); absent = the morph layer draws as any layer. */
  morph?: MorphDraw;
}

const LIGHT_MODE = { all: 1, saturated: 2 } as const;

/**
 * The light gain of a layer: the eye light's eyeGain on a recoloured eye, else the old multiply. An
 * emissive eye or iris with `tint: false` (cast-face-pass) takes eyeGain alone, in the art's colour.
 */
export function gainOf(layer: Layer, pose: Pick<LayerPose, "tint">, light: LookLight, plan: LayerRecolour | undefined): Rgb {
  return [gainChannel(layer, pose, light, plan, 0), gainChannel(layer, pose, light, plan, 1), gainChannel(layer, pose, light, plan, 2)];
}

/** One channel of `gainOf`, without the tuple (the per-frame draw path). */
function gainChannel(layer: Layer, pose: Pick<LayerPose, "tint">, light: LookLight, plan: LayerRecolour | undefined, c: 0 | 1 | 2): number {
  if (plan?.light?.name === "eye" || (keepsArtColour(layer) && isEmissive(layer))) return pose.tint * light.eyeGain;
  return pose.tint * ((layer.kind === "eye" || layer.kind === "iris") && isEmissive(layer) ? light.eye[c] : 1);
}

/** The whole texture (a base quad's map rect, a closed lid's). */
const FULL_RECT: readonly number[] = [0, 0, 1, 1];
/** `u_m` for every layer quad (perfection-pass P1): one buffer, refilled per pose, never kept by GL. */
const MATRIX = new Float32Array(9);

/** The recolour uniforms of one layer (u_recolour 0 skips the path: the old pixels exactly). */
function setRecolour(gl: WebGL2RenderingContext, u: Programs["base"]["u"], plan: LayerRecolour | undefined, map: GlTexture | undefined): void {
  gl.uniform1f(u.u_recolour, plan === undefined ? 0 : 1);
  if (plan === undefined) return;
  const lit = plan.light;
  gl.uniform4f(u.u_light, lit?.target[0] ?? 0, lit?.target[1] ?? 0, lit?.target[2] ?? 0, lit === undefined ? 0 : LIGHT_MODE[lit.mode]);
  const on = plan.slots.map((s) => (map !== undefined && s !== undefined ? 1 : 0));
  gl.uniform4f(u.u_slotOn, on[0] ?? 0, on[1] ?? 0, on[2] ?? 0, on[3] ?? 0);
  gl.uniform3fv(u.u_slots, plan.slots.flatMap((s) => s ?? [0, 0, 0]));
  gl.uniform4f(u.u_slotRef, plan.refs[0] ?? -1, plan.refs[1] ?? -1, plan.refs[2] ?? -1, plan.refs[3] ?? -1);
  gl.uniform1f(u.u_soft, plan.soft === true ? 1 : 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, map?.texture ?? null);
  gl.uniform4f(u.u_mapRect, 0, 0, 1, 1);
}

/** The warp's entry for the pose at `index`, if it warps that pose (no closure per pose). */
function warpLayerAt(warp: WarpPlan | undefined, index: number): WarpLayer | undefined {
  if (warp === undefined) return undefined;
  for (let i = 0; i < warp.layers.length; i += 1) if (warp.layers[i]?.index === index) return warp.layers[i];
  return undefined;
}

/**
 * One quad's per-draw uniforms and the draw. `mapR` set = a patch or lid on a mapped layer (u_mapRect).
 * `strip`: the bound VAO's vertex count (4, or the turn grid's).
 */
function drawQuad(gl: WebGL2RenderingContext, u: Programs["base"]["u"], texture: GlTexture, rect: readonly number[], mapR: readonly number[] | undefined, opacity: number, rimR: number, rimG: number, rimB: number, strip: number): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture.texture);
  gl.uniform4f(u.u_rect, rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0);
  gl.uniform2f(u.u_texel, texture.texel[0], texture.texel[1]);
  gl.uniform1f(u.u_opacity, opacity);
  gl.uniform3f(u.u_rim, rimR, rimG, rimB);
  if (mapR !== undefined) gl.uniform4f(u.u_mapRect, mapR[0] ?? 0, mapR[1] ?? 0, mapR[2] ?? 1, mapR[3] ?? 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, strip);
}

/** The ready face patch of `face` on `layer` (uploading it on first need), or undefined. */
function readyPatch(layer: Layer, face: { family: ExpressionFamily; weight: number }, store: TextureStore): GlTexture | undefined {
  const patch = layer.variants?.[face.family];
  return patch === undefined || !(face.weight > 0) ? undefined : store.get(patch.file, "patch");
}

/**
 * Draws one pose's quads (design "Faces", face-control): the base, the ready face patches, then the
 * closed lid; returns the draw count. Patches are found first (their replace weights set the
 * base's opacity), then drawn in order; no quad list is built (perfection-pass P1).
 */
function drawPoseQuads(gl: WebGL2RenderingContext, u: Programs["base"]["u"], programs: Programs, entry: LayerTexture, pose: LayerPose, store: TextureStore, mapped: boolean, rimR: number, rimG: number, rimB: number, warped: WarpLayer | undefined, strip: number, morphed?: MorphDraw): number {
  const { layer } = entry;
  const opacity = Math.min(1, Math.max(0, pose.opacity));
  const faces = pose.faces;
  let replaced = 0;
  let ready = 0;
  if (faces !== undefined) {
    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i];
      const patch = face === undefined ? undefined : layer.variants?.[face.family];
      if (face === undefined || patch === undefined || readyPatch(layer, face, store) === undefined) continue;
      if (patch.mode === "replace") replaced += face.weight;
      ready += 1;
    }
  }
  const shut = layer.closed === undefined || !(pose.closed !== undefined && pose.closed > 0) ? undefined : store.get(layer.closed, "patch");
  let draws = 0;
  const base = opacity * Math.max(0, 1 - replaced);
  if (!(ready > 0 && base <= 0)) {
    if (warped !== undefined) setWarpDraw(gl, programs.warp.u, warped, layer.bbox);
    morphed?.rect(gl, layer.bbox);
    drawQuad(gl, u, entry, layer.bbox, undefined, base, rimR, rimG, rimB, strip);
    draws += 1;
  }
  if (faces !== undefined && ready > 0) {
    for (let i = 0; i < faces.length; i += 1) {
      const face = faces[i];
      const patch = face === undefined ? undefined : layer.variants?.[face.family];
      const texture = face === undefined ? undefined : readyPatch(layer, face, store);
      if (face === undefined || patch === undefined || texture === undefined) continue;
      if (warped !== undefined) setWarpDraw(gl, programs.warp.u, warped, patch.bbox);
      morphed?.rect(gl, patch.bbox);
      drawQuad(gl, u, texture, patch.bbox, mapped ? mapRect(layer.bbox, patch.bbox) : undefined, opacity * Math.min(1, face.weight), 0, 0, 0, strip);
      draws += 1;
    }
  }
  if (shut !== undefined) {
    if (warped !== undefined) setWarpDraw(gl, programs.warp.u, warped, layer.bbox);
    morphed?.rect(gl, layer.bbox);
    drawQuad(gl, u, shut, layer.bbox, mapped ? FULL_RECT : undefined, opacity * Math.min(1, pose.closed ?? 0), 0, 0, 0, strip);
    draws += 1;
  }
  return draws;
}

/** The drawn mouth (base program bound): on the head, bent and lit with it. */
function drawAfter(gl: WebGL2RenderingContext, programs: Programs, after: { draw: (strip: number) => number }, turn: TurnFrame | undefined, bends: boolean): number {
  setTurnLayer(gl, programs.base.u, turn, bends, turn !== undefined && turn.light > 0);
  return after.draw(bindStrip(gl, programs, bends));
}

/**
 * Draws the poses into the bound framebuffer (the scene target: colour + glow source) and returns
 * the number of draw calls. Poses without a texture are skipped. A pose with `faces` draws its
 * base at `1 - sum(replace weights)` (a face whose patch is not loaded yet counts 0), then each
 * ready patch at its bbox in the layer's transform at its weight, with the layer's recolour; a
 * patch has no rim (its edges are inside the face). `after` draws extra quads (the drawn mouth,
 * gl/mouth.ts) right after the pose at `after.index`, with the base program still bound. `warp`
 * (the art mouth, gl/warp.ts) draws the head and the jaw and their patches with the warp program;
 * every other quad, and every quad of a frame without it, draws with the base program as before.
 * `lighting.turn` (perfection-pass V2) bends and relights the head's layers; `after.draw` gets the
 * vertex count of the VAO bound for it (the drawn mouth sits on the head and bends with it).
 */
export function drawLayers(
  gl: WebGL2RenderingContext,
  programs: Programs,
  textures: ReadonlyMap<string, LayerTexture>,
  poses: readonly LayerPose[],
  view: View,
  lighting: LayerLighting,
  after?: { index: number; draw: (strip: number) => number },
  warp?: WarpPlan,
): number {
  const { light, recolours, store, dim, morph } = lighting;
  const turn = lighting.turn?.active === true ? lighting.turn : undefined;
  const { base } = programs;
  gl.useProgram(base.program);
  bindStrip(gl, programs, false, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const shared = (u: Programs["base"]["u"]): void => {
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1i(u.u_map, 1);
    gl.uniform2f(u.u_res, view.width, view.height);
    if (turn !== undefined) setTurnFrame(gl, u, turn);
  };
  shared(base.u);
  const bends = turn !== undefined && (turn.shiftX !== 0 || turn.shiftY !== 0);
  let warpReady = false;
  let irisReady = false;
  let morphReady = false;
  let byName: Map<string, Layer> | undefined;
  let draws = 0;
  for (let index = 0; index < poses.length; index += 1) {
    const pose = poses[index];
    const entry = pose === undefined ? undefined : textures.get(pose.name);
    if (pose === undefined || entry === undefined) continue;
    const { layer } = entry;
    if (layer.kind === "iris") byName ??= new Map([...textures.values()].map((t) => [t.layer.name, t.layer]));
    const clip = byName === undefined || layer.kind !== "iris" ? "plain" : irisClipOf(layer, pose, byName, poses, store);
    if (clip === undefined) {
      if (after?.index === index) draws += drawAfter(gl, programs, after, turn, bends);
      continue;
    }
    const warped = warpLayerAt(warp, index);
    const masked = clip === "plain" ? undefined : clip;
    const morphed = morph !== undefined && warped === undefined && masked === undefined && morph.layer === layer.name ? morph : undefined;
    const { u } = warped !== undefined ? programs.warp : masked !== undefined ? programs.iris : morphed !== undefined ? morphed.program : base;
    if (warp !== undefined && warped !== undefined) {
      gl.useProgram(programs.warp.program);
      if (!warpReady) shared(u);
      warpReady = true;
      setWarp(gl, programs.warp.u, warp, warped);
    } else if (masked !== undefined) {
      gl.useProgram(programs.iris.program);
      if (!irisReady) shared(u);
      irisReady = true;
      setIrisClip(gl, programs.iris.u, masked);
    } else if (morphed !== undefined) {
      gl.useProgram(morphed.program.program);
      if (!morphReady) shared(u);
      morphReady = true;
      morphed.bind(gl);
    }
    const plan = recolours.get(layer.name);
    const rimOn = NO_RIM_KINDS.has(layer.kind) ? 0 : 1;
    gl.uniformMatrix3fv(u.u_m, false, layerMat3(MATRIX, layer, pose, view, light.browY));
    const dimmed = dimGain(layer, dim);
    gl.uniform3f(u.u_gain, gainChannel(layer, pose, light, plan, 0) * dimmed, gainChannel(layer, pose, light, plan, 1) * dimmed, gainChannel(layer, pose, light, plan, 2) * dimmed);
    gl.uniform1f(u.u_emissive, isEmissive(layer) ? 1 : 0);
    const map = plan !== undefined && needsMap(plan) && layer.regions !== undefined ? store.get(layer.regions.map, "map") : undefined;
    setRecolour(gl, u, plan, map);
    const rimK = rimOn * dimmed;
    const member = turn !== undefined && turn.members.has(layer.name);
    const bend = member && bends;
    setTurnLayer(gl, u, turn, bend, member && (turn?.light ?? 0) > 0 && litByTurn(layer, isEmissive(layer)));
    if (bend && masked !== undefined) gl.uniform4f(programs.iris.u.u_turnEye, masked.eye.bbox[0], masked.eye.bbox[1], masked.eye.bbox[2], masked.eye.bbox[3]);
    draws += drawPoseQuads(gl, u, programs, entry, pose, store, map !== undefined, light.rim[0] * rimK, light.rim[1] * rimK, light.rim[2] * rimK, warped, bindStrip(gl, programs, bend), morphed);
    if (warped !== undefined || masked !== undefined || morphed !== undefined) gl.useProgram(base.program);
    if (after?.index === index) draws += drawAfter(gl, programs, after, turn, bends);
  }
  if (irisReady || morphReady) clearIrisUnits(gl);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  return draws;
}
