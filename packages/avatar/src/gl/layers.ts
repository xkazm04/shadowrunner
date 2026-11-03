// Layer textures and the base pass (avatar-renderer task 3.3, req 1.1-1.3, 7.2): one texture per
// visible rig layer, uploaded once in `setRig` with premultiplied alpha; one textured quad per
// `LayerPose`, in the order `poseLayers` returns, blended premultiplied-over.
import { EMISSIVE_KINDS as RIG_EMISSIVE_KINDS, isEmissive, type Layer, type LayerKind, type LayerPose, type Rig } from "@sr/rig";
import { layerAffine, type LookLight, type View } from "../render/frame.js";
import type { RigAssets } from "../render/types.js";
import type { Programs } from "./programs.js";

/**
 * Kinds whose light feeds the glow pass (req 1.4) unless the layer says otherwise: a layer's own
 * `emissive` (cast-forge task 12 follow-up) wins (`isEmissive`). An eye that is not emissive also
 * takes no eye colour: it is drawn as painted.
 */
export const EMISSIVE_KINDS: ReadonlySet<LayerKind> = RIG_EMISSIVE_KINDS;
/**
 * Kinds without a rim: their edges are cuts inside the face, not silhouette (the jaw's top edge is
 * the mouth seam across the teeth; eyes sit in their sockets), so a rim there draws a seam line.
 */
export const NO_RIM_KINDS: ReadonlySet<LayerKind> = new Set(["jaw", "eye"]);

export interface LayerTexture {
  layer: Layer;
  texture: WebGLTexture;
  /** 1 / texture size, for the rim taps. */
  texel: [number, number];
}

/** Pixel size of an image asset. */
function sizeOf(image: ImageBitmap | HTMLImageElement): [number, number] {
  const natural = "naturalWidth" in image && image.naturalWidth > 0 ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  return [Math.max(1, natural[0] ?? 1), Math.max(1, natural[1] ?? 1)];
}

/**
 * Uploads one texture per layer the rig draws (`visible !== false`) that has an asset; a layer
 * hidden by a look keeps its texture, so looks never upload. Returns the textures by layer name.
 */
export function uploadLayers(gl: WebGL2RenderingContext, rig: Rig, assets: RigAssets): Map<string, LayerTexture> {
  const textures = new Map<string, LayerTexture>();
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  for (const layer of rig.layers) {
    const image = assets[layer.file];
    if (layer.visible === false || image === undefined || textures.has(layer.name)) continue;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const [w, h] = sizeOf(image);
    textures.set(layer.name, { layer, texture, texel: [1 / w, 1 / h] });
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return textures;
}

export function deleteLayers(gl: WebGL2RenderingContext, textures: Map<string, LayerTexture>): void {
  for (const { texture } of textures.values()) gl.deleteTexture(texture);
  textures.clear();
}

/**
 * Draws one quad per pose into the bound framebuffer (the scene target: colour + glow source) and
 * returns the number of draw calls. Poses without a texture are skipped.
 */
export function drawLayers(
  gl: WebGL2RenderingContext,
  programs: Programs,
  textures: ReadonlyMap<string, LayerTexture>,
  poses: readonly LayerPose[],
  view: View,
  light: LookLight,
): number {
  const { program, u } = programs.base;
  gl.useProgram(program);
  gl.bindVertexArray(programs.quad.vao);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(u.u_tex, 0);
  gl.uniform2f(u.u_res, view.width, view.height);
  let draws = 0;
  for (const pose of poses) {
    const entry = textures.get(pose.name);
    if (entry === undefined) continue;
    const { layer } = entry;
    const m = layerAffine(layer, pose, view, light.browY);
    const emissive = isEmissive(layer);
    const eye = layer.kind === "eye" && emissive ? light.eye : ([1, 1, 1] as const);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.uniform4f(u.u_rect, layer.bbox[0], layer.bbox[1], layer.bbox[2], layer.bbox[3]);
    gl.uniformMatrix3fv(u.u_m, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
    gl.uniform2f(u.u_texel, entry.texel[0], entry.texel[1]);
    gl.uniform1f(u.u_opacity, Math.min(1, Math.max(0, pose.opacity)));
    gl.uniform3f(u.u_gain, pose.tint * eye[0], pose.tint * eye[1], pose.tint * eye[2]);
    const rim = NO_RIM_KINDS.has(layer.kind) ? 0 : 1;
    gl.uniform3f(u.u_rim, light.rim[0] * rim, light.rim[1] * rim, light.rim[2] * rim);
    gl.uniform1f(u.u_emissive, emissive ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    draws += 1;
  }
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  return draws;
}
