// The art mouth in WebGL (spark art-mouth): the GLSL inverse of mouth/warp.ts's field, spliced into
// the base layer program (gl/programs.ts), and the per-frame plan the renderer hands to drawLayers:
// which poses are the head and the jaw (mouth/anchor.ts `mouthLayers`), the field for this frame's
// mouth pose and jaw gap, the interior colours from the rig's lip colour (sampled once per rig).
// A warped quad is drawn with the warp twin of the base program (gl/programs.ts) over its rect grown
// to the field's box (u_draw), so lips lifted above a layer's own bbox (the jaw is cut at the lip
// line) still have pixels to land on; samples outside the layer's texture are transparent there.
// Every other quad keeps the plain base program, so a frame without a warp costs what it did.
import { anchorOf, mouthGeometry, mouthLayers, mouthMode } from "../mouth/anchor.js";
import type { MouthRgb } from "../mouth/colours.js";
import { SHAPE_PARAMS } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import { CREASE_OF_SPAN, INNER_SPAN, interiorOf, PROFILE_POW, TALL_OF_SPAN, warpBox, warpParams, WARP_STEPS, type WarpField } from "../mouth/warp.js";
import type { Layer, LayerPose, Rig } from "@sr/rig";
import type { View } from "../render/frame.js";

export const WARP_UNIFORMS = ["u_draw", "u_wLips", "u_wWin", "u_wBand", "u_wCorner", "u_wLayer", "u_wBox", "u_wNear", "u_wDeep"] as const;
export type WarpUniform = (typeof WARP_UNIFORMS)[number];

/**
 * mouth/warp.ts in GLSL, function for function. Packing: u_wLips (cx, seam, hwL, hwR), u_wWin
 * (winL, winR, fu, fd), u_wBand (upper, lower, lift, open), u_wCorner (dxL, dyL, dxR, dyR),
 * u_wLayer (gap, jaw 0/1, squeeze, -), u_wBox (x0, y0, x1, y1). `unwarp` returns the source point
 * (xy) and the interior share (z; drawn at the layer's own alpha there); `s` is the interior shade
 * (0 deep .. 1 near).
 */
export const WARP_GLSL = `uniform vec4 u_wLips;
uniform vec4 u_wWin;
uniform vec4 u_wBand;
uniform vec4 u_wCorner;
uniform vec4 u_wLayer;
uniform vec4 u_wBox;
uniform vec3 u_wNear;
uniform vec3 u_wDeep;
float wHw(float x) { return x < u_wLips.x ? u_wLips.z : u_wLips.w; }
float wT(float x) { return abs(x - u_wLips.x) / wHw(x); }
float wFade(float x, float t) { return 1.0 - smoothstep(1.0, (x < u_wLips.x ? u_wWin.x : u_wWin.y) / wHw(x), t); }
float wAx(float x) { float t = wT(x); return t <= 1.0 ? t : wFade(x, t); }
float wAy(float x) { float t = wT(x); return t <= 1.0 ? t * t : wFade(x, t); }
float wWx(float x) { float t = wT(x); return t <= 1.0 ? 1.0 : wFade(x, t); }
float wProf(float x) { float t = wT(x) / ${INNER_SPAN.toFixed(4)}; return t < 1.0 ? pow(1.0 - t * t, ${PROFILE_POW.toFixed(4)}) : 0.0; }
float wUp(float y) { return smoothstep(u_wBand.x - u_wWin.z, u_wBand.x, y); }
float wLow(float y) { return 1.0 - smoothstep(u_wBand.y, u_wBand.y + u_wWin.w, y); }
float wDx(float x, float y) { return (x < u_wLips.x ? u_wCorner.x : u_wCorner.z) * wAx(x) * wUp(y) * wLow(y); }
float wDc(float x, float y) {
  float sq = clamp(u_wLips.y - y, u_wLips.y - u_wBand.y, u_wLips.y - u_wBand.x);
  return ((x < u_wLips.x ? u_wCorner.y : u_wCorner.w) * wAy(x) + u_wLayer.z * sq * wWx(x)) * wUp(y) * wLow(y);
}
vec4 unwarp(vec2 p, float aa, out float s) {
  s = 0.0;
  if (p.x < u_wBox.x || p.x > u_wBox.z || p.y < u_wBox.y || p.y > u_wBox.w) return vec4(p, 0.0, 1.0);
  float seam = u_wLips.y;
  float lift = u_wBand.z;
  float open = u_wBand.w;
  bool jaw = u_wLayer.y > 0.5;
  float pin = jaw ? u_wLayer.x : 0.0;
  float qx = p.x;
  for (int i = 0; i < ${WARP_STEPS}; i++) qx = p.x - wDx(qx, p.y);
  float prof = wProf(qx);
  float base = seam + (qx < u_wLips.x ? u_wCorner.y : u_wCorner.w) * wAy(qx) - pin;
  float yu = base - lift * prof;
  float yl = base + open * prof;
  float span = u_wLips.z + u_wLips.w;
  float h = yl - yu;
  float v = clamp((p.y - yu) / max(h, 1e-3), 0.0, 1.0);
  float edge = abs(2.0 * v - 1.0);
  s = smoothstep(0.0, ${TALL_OF_SPAN.toFixed(4)} * span, h) * clamp(0.5 * edge * edge + 0.25 * v, 0.0, 1.0);
  float core = clamp((min(yl, p.y + aa) - max(yu, p.y - aa)) / (2.0 * aa), 0.0, 1.0);
  float crease = ${CREASE_OF_SPAN.toFixed(4)} * span;
  float band = crease * smoothstep(0.0, 3.0 * crease, h);
  float inner = max(core, band > 1e-3 ? 1.0 - smoothstep(0.0, band + aa, max(yu - p.y, p.y - yl)) : 0.0);
  float qy = p.y;
  if (p.y < 0.5 * (yu + yl)) {
    for (int i = 0; i < ${WARP_STEPS}; i++) qy = min(seam, p.y - wDc(qx, qy) + lift * prof * wUp(qy) + pin);
  } else {
    for (int i = 0; i < ${WARP_STEPS}; i++) qy = max(seam, p.y - wDc(qx, qy) - (open * prof - pin) * wLow(qy));
  }
  return vec4(qx, qy, inner, 1.0);
}
vec3 wInterior(float s) { return mix(u_wDeep, u_wNear, s); }`;

/** One warped pose: its index in the frame's poses, its box and whether it is the jaw. */
export interface WarpLayer {
  index: number;
  box: [number, number, number, number];
  jaw: boolean;
}

export interface WarpPlan {
  field: WarpField;
  near: readonly [number, number, number];
  deep: readonly [number, number, number];
  layers: WarpLayer[];
}

/**
 * This frame's warp, or undefined (a rig that is not "warp", no jaw drawn, or a field that moves
 * nothing: rest params with the jaw shut, which draws today's frame exactly). No pose with the jaw
 * open still warps at rest params, so the lips close at the corners and the jaw does not double-move.
 */
export function planWarp(rig: Rig, layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[], view: View, browY: number, pose: MouthPose | undefined, lip: () => MouthRgb | undefined): WarpPlan | undefined {
  const mouth = rig.mouth;
  const geometry = mouthGeometry(mouth);
  if (mouth === undefined || geometry === undefined || mouthMode(mouth) !== "warp") return undefined;
  const found = mouthLayers(layers, poses);
  if (found === undefined) return undefined;
  const { gap } = anchorOf(geometry, found.jaw, found.head, view, browY);
  const field = warpParams(pose?.params ?? SHAPE_PARAMS.rest, mouth, gap);
  if (field === undefined) return undefined;
  const { near, deep } = interiorOf(lip());
  const out: WarpLayer[] = [{ index: found.jaw.index, box: warpBox(field, found.jaw.layer.bbox), jaw: true }];
  if (found.head !== undefined) out.push({ index: found.head.index, box: warpBox(field), jaw: false });
  return { field, near, deep, layers: out };
}

type Locations = Record<WarpUniform, WebGLUniformLocation | null>;

/** Sets the field's uniforms for one warped pose (u_draw is per quad, `setWarpDraw`). */
export function setWarp(gl: WebGL2RenderingContext, u: Locations, plan: WarpPlan, layer: WarpLayer): void {
  const f = plan.field;
  gl.uniform4f(u.u_wLips, f.cx, f.seam, f.hwL, f.hwR);
  gl.uniform4f(u.u_wWin, f.winL, f.winR, f.fu, f.fd);
  gl.uniform4f(u.u_wBand, f.upper, f.lower, f.lift, f.open);
  gl.uniform4f(u.u_wCorner, f.dxL, f.dyL, f.dxR, f.dyR);
  gl.uniform4f(u.u_wLayer, layer.jaw ? f.gap : 0, layer.jaw ? 1 : 0, f.squeeze, 0);
  gl.uniform4f(u.u_wBox, layer.box[0], layer.box[1], layer.box[2], layer.box[3]);
  gl.uniform3f(u.u_wNear, plan.near[0], plan.near[1], plan.near[2]);
  gl.uniform3f(u.u_wDeep, plan.deep[0], plan.deep[1], plan.deep[2]);
}

/** u_draw for one quad: its rect grown to cover the warped layer's box. */
export function setWarpDraw(gl: WebGL2RenderingContext, u: Locations, layer: WarpLayer, rect: readonly number[]): void {
  const x = rect[0] ?? 0;
  const y = rect[1] ?? 0;
  const x0 = Math.min(x, layer.box[0]);
  const y0 = Math.min(y, layer.box[1]);
  const x1 = Math.max(x + (rect[2] ?? 0), layer.box[2]);
  const y1 = Math.max(y + (rect[3] ?? 0), layer.box[3]);
  gl.uniform4f(u.u_draw, x0, y0, x1 - x0, y1 - y0);
}
