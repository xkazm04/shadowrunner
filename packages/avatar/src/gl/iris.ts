// The iris draw on WebGL2 (face-control, WP-A): an iris layer whose eye has a `socket` is drawn with
// the iris twin of the base program (gl/programs.ts), which multiplies it by the eye's socket masks
// (render/socket.ts: up to three, the eye's own and its shown faces', blended by weight) sampled at
// the iris's point mapped into the eye's posed frame. The masks are textures on units 2-4.
//
// Decisions the brief leaves open:
// - An iris whose eye has a socket but whose mask image is not ready (still loading, or failed) is
//   not drawn at all: never outside the socket. A face mask that is not ready lends its weight to
//   the eye's own mask.
// - An iris whose eye has no socket, or that follows no eye, is drawn as a plain layer (nothing to
//   clip it by).
import type { Layer, LayerPose } from "@sr/rig";
import { irisMaskMap, socketWeights } from "../render/socket.js";
import type { IrisProgramUniform, Program } from "./programs.js";
import type { GlTexture, TextureStore } from "./textures.js";

export interface IrisClip {
  /** Iris rest canvas px -> the eye's socket uv, as a column-major mat3. */
  maskM: number[];
  /** Up to three mask textures and their weights. */
  masks: { texture: GlTexture; weight: number }[];
}

/** The eye an iris is clipped by: a posed eye layer with a `socket`. */
export function socketEyeOf(layer: Layer, layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[]): { eye: Layer; pose: LayerPose } | undefined {
  if (layer.kind !== "iris" || layer.follow === undefined) return undefined;
  const eye = layers.get(layer.follow);
  if (eye?.kind !== "eye" || eye.socket === undefined) return undefined;
  const pose = poses.find((p) => p.name === eye.name);
  return pose === undefined ? undefined : { eye, pose };
}

/**
 * The clip for an iris pose: "plain" when it has no socket to be clipped by, undefined when it must
 * not be drawn this frame (its eye is not posed, or the eye's mask is not ready).
 */
export function irisClipOf(layer: Layer, pose: LayerPose, layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[], store: TextureStore): IrisClip | "plain" | undefined {
  if (layer.kind !== "iris") return "plain";
  const eye = layer.follow === undefined ? undefined : layers.get(layer.follow);
  if (eye?.kind !== "eye" || eye.socket === undefined) return "plain";
  const found = socketEyeOf(layer, layers, poses);
  if (found === undefined) return undefined;
  const base = store.get(eye.socket, "patch");
  if (base === undefined) return undefined;
  const map = irisMaskMap(layer, pose, found.eye, found.pose);
  if (map === undefined) return undefined;
  const masks = new Map<GlTexture, number>();
  for (const { file, weight } of socketWeights(found.eye, found.pose)) {
    const texture = store.get(file, "patch") ?? base;
    masks.set(texture, (masks.get(texture) ?? 0) + weight);
  }
  const list = [...masks].map(([texture, weight]) => ({ texture, weight })).slice(0, 3);
  return { maskM: [map[0], map[1], 0, map[2], map[3], 0, map[4], map[5], 1], masks: list };
}

/** Binds the clip's masks (units 2-4) and sets the iris program's mask uniforms. */
export function setIrisClip(gl: WebGL2RenderingContext, u: Program<IrisProgramUniform>["u"], clip: IrisClip): void {
  gl.uniformMatrix3fv(u.u_maskM, false, clip.maskM);
  const units = [u.u_mask0, u.u_mask1, u.u_mask2];
  const weights = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const mask = clip.masks[i] ?? clip.masks[0];
    weights[i] = clip.masks[i]?.weight ?? 0;
    gl.activeTexture(gl.TEXTURE2 + i);
    gl.bindTexture(gl.TEXTURE_2D, mask?.texture.texture ?? null);
    gl.uniform1i(units[i] ?? null, 2 + i);
  }
  gl.uniform3f(u.u_maskW, weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0);
  gl.activeTexture(gl.TEXTURE0);
}

/** Unbinds the mask units after the pass. */
export function clearIrisUnits(gl: WebGL2RenderingContext): void {
  for (let i = 0; i < 3; i += 1) {
    gl.activeTexture(gl.TEXTURE2 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.activeTexture(gl.TEXTURE0);
}
