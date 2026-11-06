// Layer textures and the base pass (avatar-renderer task 3.3, req 1.1-1.3, 7.2): one texture per
// visible rig layer, uploaded once in `setRig` with premultiplied alpha; one textured quad per
// `LayerPose`, in the order `poseLayers` returns, blended premultiplied-over. Character-control
// adds the recolour uniforms (render/recolour.ts), the region map on unit 1, and face patches.
import { EMISSIVE_KINDS as RIG_EMISSIVE_KINDS, isEmissive, type Layer, type LayerKind, type LayerPose, type Rig } from "@sr/rig";
import { dimGain, layerAffine, type LookLight, type Rgb, type View } from "../render/frame.js";
import { mapRect, needsMap, type LayerRecolour } from "../render/recolour.js";
import type { RigAssets } from "../render/types.js";
import type { Programs } from "./programs.js";
import { uploadImage, type GlTexture, type TextureStore } from "./textures.js";

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
}

const LIGHT_MODE = { all: 1, saturated: 2 } as const;

/** The light gain of a layer: the eye light's eyeGain on a recoloured eye, else the old multiply. */
export function gainOf(layer: Layer, pose: Pick<LayerPose, "tint">, light: LookLight, plan: LayerRecolour | undefined): Rgb {
  if (plan?.light?.name === "eye") return [pose.tint * light.eyeGain, pose.tint * light.eyeGain, pose.tint * light.eyeGain];
  const eye = layer.kind === "eye" && isEmissive(layer) ? light.eye : ([1, 1, 1] as const);
  return [pose.tint * eye[0], pose.tint * eye[1], pose.tint * eye[2]];
}

interface Quad {
  texture: GlTexture;
  rect: readonly number[];
  mapRect: readonly number[];
  opacity: number;
  rim: Rgb;
}

/** The recolour uniforms of one layer (u_recolour 0 skips the path: the old pixels exactly). */
function setRecolour(gl: WebGL2RenderingContext, programs: Programs, plan: LayerRecolour | undefined, map: GlTexture | undefined): void {
  const { u } = programs.base;
  gl.uniform1f(u.u_recolour, plan === undefined ? 0 : 1);
  if (plan === undefined) return;
  const lit = plan.light;
  gl.uniform4f(u.u_light, lit?.target[0] ?? 0, lit?.target[1] ?? 0, lit?.target[2] ?? 0, lit === undefined ? 0 : LIGHT_MODE[lit.mode]);
  const on = plan.slots.map((s) => (map !== undefined && s !== undefined ? 1 : 0));
  gl.uniform4f(u.u_slotOn, on[0] ?? 0, on[1] ?? 0, on[2] ?? 0, on[3] ?? 0);
  gl.uniform3fv(u.u_slots, plan.slots.flatMap((s) => s ?? [0, 0, 0]));
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, map?.texture ?? null);
  gl.uniform4f(u.u_mapRect, 0, 0, 1, 1);
}

/** The base quad and the ready face patches of one pose (design "Faces"). */
function quadsOf(entry: LayerTexture, pose: LayerPose, store: TextureStore, rim: Rgb): Quad[] {
  const { layer } = entry;
  const opacity = Math.min(1, Math.max(0, pose.opacity));
  const faces: Quad[] = [];
  let replaced = 0;
  for (const face of pose.faces ?? []) {
    const patch = layer.variants?.[face.family];
    const texture = patch === undefined || !(face.weight > 0) ? undefined : store.get(patch.file, "patch");
    if (patch === undefined || texture === undefined) continue;
    if (patch.mode === "replace") replaced += face.weight;
    faces.push({ texture, rect: patch.bbox, mapRect: mapRect(layer.bbox, patch.bbox), opacity: opacity * Math.min(1, face.weight), rim: [0, 0, 0] });
  }
  const base = opacity * Math.max(0, 1 - replaced);
  if (faces.length > 0 && base <= 0) return faces;
  return [{ texture: entry, rect: layer.bbox, mapRect: [0, 0, 1, 1], opacity: base, rim }, ...faces];
}

/**
 * Draws the poses into the bound framebuffer (the scene target: colour + glow source) and returns
 * the number of draw calls. Poses without a texture are skipped. A pose with `faces` draws its
 * base at `1 - sum(replace weights)` (a face whose patch is not loaded yet counts 0), then each
 * ready patch at its bbox in the layer's transform at its weight, with the layer's recolour; a
 * patch has no rim (its edges are inside the face). `after` draws extra quads (the drawn mouth,
 * gl/mouth.ts) right after the pose at `after.index`, with the base program still bound.
 */
export function drawLayers(
  gl: WebGL2RenderingContext,
  programs: Programs,
  textures: ReadonlyMap<string, LayerTexture>,
  poses: readonly LayerPose[],
  view: View,
  lighting: LayerLighting,
  after?: { index: number; draw: () => number },
): number {
  const { light, recolours, store, dim } = lighting;
  const { program, u } = programs.base;
  gl.useProgram(program);
  gl.bindVertexArray(programs.quad.vao);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(u.u_tex, 0);
  gl.uniform1i(u.u_map, 1);
  gl.uniform2f(u.u_res, view.width, view.height);
  let draws = 0;
  for (let index = 0; index < poses.length; index += 1) {
    const pose = poses[index];
    const entry = pose === undefined ? undefined : textures.get(pose.name);
    if (pose === undefined || entry === undefined) continue;
    const { layer } = entry;
    const m = layerAffine(layer, pose, view, light.browY);
    const plan = recolours.get(layer.name);
    const rimOn = NO_RIM_KINDS.has(layer.kind) ? 0 : 1;
    gl.uniformMatrix3fv(u.u_m, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
    const dimmed = dimGain(layer, dim);
    const gain = gainOf(layer, pose, light, plan);
    gl.uniform3f(u.u_gain, gain[0] * dimmed, gain[1] * dimmed, gain[2] * dimmed);
    gl.uniform1f(u.u_emissive, isEmissive(layer) ? 1 : 0);
    const map = plan !== undefined && needsMap(plan) && layer.regions !== undefined ? store.get(layer.regions.map, "map") : undefined;
    setRecolour(gl, programs, plan, map);
    const rimK = rimOn * dimmed;
    const quads = quadsOf(entry, pose, store, [light.rim[0] * rimK, light.rim[1] * rimK, light.rim[2] * rimK]);
    for (const quad of quads) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, quad.texture.texture);
      gl.uniform4f(u.u_rect, quad.rect[0] ?? 0, quad.rect[1] ?? 0, quad.rect[2] ?? 0, quad.rect[3] ?? 0);
      gl.uniform2f(u.u_texel, quad.texture.texel[0], quad.texture.texel[1]);
      gl.uniform1f(u.u_opacity, quad.opacity);
      gl.uniform3f(u.u_rim, quad.rim[0], quad.rim[1], quad.rim[2]);
      if (map !== undefined && quad.texture !== entry) gl.uniform4f(u.u_mapRect, quad.mapRect[0] ?? 0, quad.mapRect[1] ?? 0, quad.mapRect[2] ?? 1, quad.mapRect[3] ?? 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      draws += 1;
    }
    if (after?.index === index) draws += after.draw();
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  return draws;
}
