// The drawn mouth in WebGL (spark llm-avatar-lab, "the rig owns the mouth"). A GL context cannot be
// 2D-painted, so the mouth (mouth/paint.ts, the same paint as canvas2d) is painted into a small
// offscreen 2D canvas cropped around the mouth, at the head's device scale, uploaded as a texture
// and drawn as one quad with the base program in the head's transform, right after the later of the
// head and the jaw (gl/layers.ts `after`). It repaints and re-uploads only when something it shows
// changed (params, alpha, jaw gap, opacity, scale, colours). It is not emissive: in the glow source
// it occludes like the face it sits on, and never blooms.
import type { MouthAnchor } from "../mouth/anchor.js";
import { defaultMouthSurface, type MouthColours, type MouthSurface, type MouthSurfaceFactory } from "../mouth/colours.js";
import type { MouthArt } from "../mouth/draw.js";
import { PARAM_KEYS } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import type { Affine, Rgb } from "../render/frame.js";
import type { Programs } from "./programs.js";

/** The crop about the mouth, in mouth widths from (cx, lineY): the skin cover and the widest mouth fit. */
export const MOUTH_BOX = { left: 0.75, up: 0.36, width: 1.5, height: 1.06 } as const;
/** The offscreen canvas never grows past this many px on a side. */
export const MOUTH_TEXTURE_MAX = 1024;

export interface GlMouth {
  /** Draws the mouth quad (the base program and quad VAO bound); returns the draw calls (0 or 1). */
  draw(art: MouthArt, anchor: MouthAnchor, pose: MouthPose, colours: MouthColours, gain: Rgb): number;
  /** Times the texture was (re)uploaded (tests, info). */
  uploads(): number;
  dispose(): void;
}

const KEY_SIZE = PARAM_KEYS.length + 6;

export function createGlMouth(gl: WebGL2RenderingContext, programs: Programs, surface: MouthSurfaceFactory = defaultMouthSurface): GlMouth {
  let texture: WebGLTexture | undefined;
  let canvas: MouthSurface | undefined;
  let texSize: [number, number] = [0, 0];
  let lastColours: MouthColours | undefined;
  let uploads = 0;
  const key = new Float64Array(KEY_SIZE).fill(NaN);
  const next = new Float64Array(KEY_SIZE);
  const local: Affine = [1, 0, 0, 1, 0, 0];
  const anchorAt: MouthAnchor = { geometry: { cx: 0, lineY: 0, width: 1, maxOpen: 1 }, affine: local, gap: 0, opacity: 1 };
  const rect: [number, number, number, number] = [0, 0, 1, 1];

  /** Fills `next` with what the mouth shows; true when it differs from the last upload. */
  const changed = (anchor: MouthAnchor, pose: MouthPose, colours: MouthColours, scale: number): boolean => {
    let i = 0;
    for (const k of PARAM_KEYS) next[i++] = pose.params[k];
    next[i++] = pose.alpha;
    next[i++] = pose.lips;
    next[i++] = anchor.gap;
    next[i++] = anchor.opacity;
    next[i++] = scale;
    next[i] = anchor.geometry.width;
    let same = colours === lastColours;
    for (let j = 0; j < KEY_SIZE && same; j += 1) same = key[j] === next[j];
    return !same;
  };

  return {
    draw(art, anchor, pose, colours, gain) {
      const { cx, lineY, width } = anchor.geometry;
      rect[0] = cx - width * MOUTH_BOX.left;
      rect[1] = lineY - width * MOUTH_BOX.up;
      rect[2] = width * MOUTH_BOX.width;
      rect[3] = width * MOUTH_BOX.height;
      // Device px per rig px in the head's frame, capped so the crop stays small.
      const m = anchor.affine;
      const scale = Math.min(Math.hypot(m[0], m[1]), MOUTH_TEXTURE_MAX / rect[2]);
      if (!(scale > 0)) return 0;
      const w = Math.max(1, Math.ceil(rect[2] * scale));
      const h = Math.max(1, Math.ceil(rect[3] * scale));
      if (changed(anchor, pose, colours, scale)) {
        if (canvas === undefined || canvas.canvas.width !== w || canvas.canvas.height !== h) canvas = surface(w, h) ?? undefined;
        if (canvas === undefined) return 0;
        const g = canvas.g;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, w, h);
        local[0] = scale;
        local[3] = scale;
        local[4] = -rect[0] * scale;
        local[5] = -rect[1] * scale;
        anchorAt.geometry = anchor.geometry;
        anchorAt.gap = anchor.gap;
        anchorAt.opacity = anchor.opacity;
        art.paint(g, anchorAt, pose, colours);
        texture ??= gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (texSize[0] === w && texSize[1] === h) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas.canvas);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas.canvas);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          texSize = [w, h];
        }
        uploads += 1;
        key.set(next);
        lastColours = colours;
      }
      if (texture === undefined) return 0;
      const { u } = programs.base;
      gl.uniformMatrix3fv(u.u_m, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1]);
      gl.uniform3f(u.u_gain, gain[0], gain[1], gain[2]);
      gl.uniform1f(u.u_emissive, 0);
      gl.uniform1f(u.u_recolour, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // The texture covers exactly the rect: its px are rect px x scale, so the quad maps 1:1.
      gl.uniform4f(u.u_rect, rect[0], rect[1], w / scale, h / scale);
      gl.uniform2f(u.u_texel, 1 / w, 1 / h);
      gl.uniform1f(u.u_opacity, 1);
      gl.uniform3f(u.u_rim, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return 1;
    },
    uploads: () => uploads,
    dispose() {
      if (texture !== undefined) gl.deleteTexture(texture);
      texture = undefined;
      canvas = undefined;
      texSize = [0, 0];
      key.fill(NaN);
    },
  };
}
