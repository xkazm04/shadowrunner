// Shader sources and compile/link (avatar-renderer task 3.2): the base layer program (writes the
// colour and the glow source in one pass, two render targets), and three full-screen programs for
// the glow: extract (downsample to half res), blur (one axis of a separable 9-tap Gaussian),
// composite (scene + tinted glow onto the canvas). All share one unit-quad buffer. Face-control
// adds the iris twin of the base program: the same pass with the eye's socket masks (gl/iris.ts).
// Companion-lanes adds the morph twin (gl/morph.ts), linked on first need: the warp twin's vertex
// stage and the base fragment with its texture read replaced by `LayerSample` (`baseFs`'s third arg).
import { GLOW_SATURATION, L_EPS, S_FLOOR, S_KEEP } from "../render/recolour.js";
import { MAW_DARK_LUMA, MAW_TAPS } from "../mouth/warp.js";
import { createTurnGrid, TURN_FS, TURN_LIGHT_STEP, TURN_UNIFORMS, TURN_VS } from "./turn.js";
import { WARP_GLSL, WARP_UNIFORMS } from "./warp.js";

/**
 * The recolour rule in GLSL (render/recolour.ts `rgbToHsl`, `hslToRgb`, `recolourHsl`), exported so
 * a test can port it line for line. HSL components are 0..1.
 */
export const RECOLOUR_GLSL = `vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d <= 0.0) return vec3(0.0, 0.0, l);
  float s = min(1.0, d / (1.0 - abs(2.0 * l - 1.0)));
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
vec3 hsl2rgb(vec3 hsl) {
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  vec3 x = mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);
  return hsl.z + c * (clamp(abs(x - 3.0) - 1.0, 0.0, 1.0) - 0.5);
}
float mapL(float l, float lr, float lt) {
  if (lr < 0.0) return l;
  float r = clamp(lr, L_EPS, 1.0 - L_EPS);
  float t = clamp(lt, L_EPS, 1.0 - L_EPS);
  return l <= r ? l * t / r : t + (l - r) * (1.0 - t) / (1.0 - r);
}
vec3 recolour(vec3 src, vec3 target, float ref) {
  float s = max(target.y * S_KEEP + src.y * (1.0 - S_KEEP), S_FLOOR * target.y);
  return hsl2rgb(vec3(target.x, s, mapL(src.z, ref, target.z)));
}`;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// Unit corner -> the layer's rest bbox in rig px -> device px (u_m, an affine) -> clip space. The
// warp twin (the art mouth, gl/warp.ts) covers u_draw instead, and v_uv runs past 0..1 outside u_rect.
// The iris twin (face-control) also carries the rest point into the eye's socket uv (u_maskM).
// Depth turn (perfection-pass V2, gl/turn.ts): the rest point is shifted by `turnAt` before u_m while
// u_turnK.xy is not zero (an iris by its eye's point under it, u_turnEye); v_rest feeds the light.
export const baseVs = (warp: boolean, mask = false): string => `#version 300 es
layout(location = 0) in vec2 a_corner;
uniform vec4 u_rect;${warp ? `
uniform vec4 u_draw;` : ""}
uniform mat3 u_m;
uniform vec2 u_res;${mask ? `
uniform mat3 u_maskM;
uniform vec4 u_turnEye;
out vec2 v_mask;` : ""}
out vec2 v_uv;
${TURN_VS}
void main() {${mask ? `
  v_mask = (u_maskM * vec3(u_rect.xy + a_corner * u_rect.zw, 1.0)).xy;` : ""}
${
  warp
    ? `  v_uv = (u_draw.xy + a_corner * u_draw.zw - u_rect.xy) / u_rect.zw;
  vec2 rest = u_draw.xy + a_corner * u_draw.zw;`
    : `  v_uv = a_corner;
  vec2 rest = u_rect.xy + a_corner * u_rect.zw;`
}
  v_rest = rest;
  if (u_turnK.x != 0.0 || u_turnK.y != 0.0) rest += turnAt(${mask ? "u_turnEye.z > 0.0 ? u_turnEye.xy + v_mask * u_turnEye.zw : rest" : "rest"});
  vec2 device = (u_m * vec3(rest, 1.0)).xy;
  gl_Position = vec4(device.x / u_res.x * 2.0 - 1.0, 1.0 - device.y / u_res.y * 2.0, 0.0, 1.0);
}`;

// Premultiplied texel x light gain, plus a rim term: smoothstep on the alpha gradient (4 taps),
// kept inside the layer by its own alpha and weighted by the texel's own brightness, so the black
// fill around cut parts (straight cut lines, inpaint patches) never draws a lit outline.
// Depth turn (perfection-pass V2, gl/turn.ts TURN_LIGHT_STEP): while u_turnK.z is set, the colour and
// the rim are relit for the turn from the same 4 taps (their alpha and luminance): no new tap.
// Emissive layers also write their bright parts (a bright-pass on the lit colour) to the glow
// source; other layers write their alpha there, so whatever is in front occludes the glow.
// Recolour (character-control design.md "Recolour"), only when u_recolour is set (a look equal to
// the rig never takes it): the straight colour's HSL; the layer light (u_light.xyz, an HSL target)
// on every pixel (u_light.w 1) or on pixels with s > GLOW_SAT (u_light.w 2); a region slot's
// target (u_slots, enabled by u_slotOn) wins on the pixels whose index map (nearest, R = slot + 1)
// names it, and maps lightness from that slot's reference (u_slotRef; -1 keeps it, as a light does).
// The rule is render/recolour.ts's `recolourHsl` and `mapLightness`, expression for expression.
// The warp twin (the art mouth, gl/warp.ts; only the head and the jaw of a talking warp rig use it,
// so every other quad runs the plain program at today's cost): the sample point is unwarped first
// (texels outside the layer are transparent), and where the lips have parted both layers show the
// dark interior (each at its own alpha at the unwarped point: whichever holds the mouth paints it).
// A maw (warp.w, its opening share) shows instead the mean of the opaque texels darker than
// MAW_DARK_LUMA among MAW_TAPS rows about the seam in its column (mouth/warp.ts `mawTaps`): the art's
// own gap, stretched (a mean, so the ink and tooth gaps a column crosses do not streak); where no
// tap is that dark the stretched seam row itself shows (skin past the mouth's curved corners). Only a layer that holds the seam row (opaque at its seam in that
// column) paints it, so a head cut above the seam never covers the jaw's row with the gap.
const WARP_SAMPLE = `  vec2 p = u_rect.xy + v_uv * u_rect.zw;
  float ws;
  vec4 warp = wSample(p, 0.5 * max(fwidth(p.y), 1e-3), ws);
  vec2 uv = (warp.xy - u_rect.xy) / u_rect.zw;
  vec4 tex = texture(u_tex, uv) * inLayer(uv);
  vec2 suv = (vec2(warp.x, u_wLips.y) - u_rect.xy) / u_rect.zw;
  float hold = u_wLayer.w > 0.0 && warp.w > 0.0 ? warp.w * smoothstep(0.25, 0.75, texture(u_tex, suv).a * inLayer(suv)) : 0.0;
  if (hold > 0.0) {
    vec4 sum = vec4(0.0);
    float n = 0.0;
    for (int i = 0; i < ${MAW_TAPS}; i++) {
      vec2 tq = (vec2(warp.x, u_wLips.y + u_wLayer.w * (2.0 * float(i) / ${(MAW_TAPS - 1).toFixed(1)} - 1.0)) - u_rect.xy) / u_rect.zw;
      vec4 t = texture(u_tex, tq) * inLayer(tq);
      float l = t.a > 0.5 ? dot(t.rgb / t.a, vec3(0.2126, 0.7152, 0.0722)) : 2.0;
      if (l < ${MAW_DARK_LUMA.toFixed(4)}) { sum += t; n += 1.0; }
    }
    if (n > 0.0) tex = mix(tex, sum / n, hold);
  }`;
const WARP_INTERIOR = `  if (warp.z > 0.0) {
    float a = texture(u_tex, v_uv).a * inLayer(v_uv);
    rgb = mix(rgb, wInterior(ws) * a, warp.z);
    alpha = mix(alpha, a, warp.z);
    rim *= 1.0 - warp.z;
  }
`;
// The iris twin's mask: the socket masks' alpha blended by u_maskW, 0 outside the eye's box.
const MASK_GLSL = `in vec2 v_mask;
uniform sampler2D u_mask0;
uniform sampler2D u_mask1;
uniform sampler2D u_mask2;
uniform vec3 u_maskW;
float socketAt(vec2 m) {
  if (m.x < 0.0 || m.x > 1.0 || m.y < 0.0 || m.y > 1.0) return 0.0;
  return u_maskW.x * texture(u_mask0, m).a + u_maskW.y * texture(u_mask1, m).a + u_maskW.z * texture(u_mask2, m).a;
}`;
/** A replacement of the base fragment's texture read: declarations, and main()'s first lines (they set `uv` and `tex`). */
export interface LayerSample {
  decl: string;
  sample: string;
}

export const baseFs = (warp: boolean, mask = false, own?: LayerSample): string => `#version 300 es
precision highp float;
in vec2 v_uv;${mask ? `
${MASK_GLSL}` : ""}
uniform sampler2D u_tex;
uniform sampler2D u_map;
uniform vec2 u_texel;
uniform float u_opacity;
uniform vec3 u_gain;
uniform vec3 u_rim;
uniform float u_emissive;
uniform float u_recolour;
uniform vec4 u_light;
uniform vec4 u_mapRect;
uniform vec4 u_slotOn;
uniform vec3 u_slots[4];
uniform vec4 u_slotRef;${warp || own !== undefined ? `
uniform vec4 u_rect;` : ""}
const float BRIGHT_LO = 0.3;
const float BRIGHT_HI = 0.7;
const float S_KEEP = ${S_KEEP.toFixed(4)};
const float S_FLOOR = ${S_FLOOR.toFixed(4)};
const float GLOW_SAT = ${GLOW_SATURATION.toFixed(4)};
const float L_EPS = ${L_EPS.toFixed(8)};
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_glow;
${RECOLOUR_GLSL}
${TURN_FS}${warp ? `
${WARP_GLSL}
float inLayer(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 ? 1.0 : 0.0; }` : ""}${own === undefined ? "" : `
${own.decl}`}
void main() {
${own !== undefined ? own.sample : warp ? WARP_SAMPLE : `  vec2 uv = v_uv;
  vec4 tex = texture(u_tex, uv);`}
  vec2 d = u_texel * 2.0;
  vec4 tR = texture(u_tex, uv + vec2(d.x, 0.0));
  vec4 tL = texture(u_tex, uv - vec2(d.x, 0.0));
  vec4 tD = texture(u_tex, uv + vec2(0.0, d.y));
  vec4 tU = texture(u_tex, uv - vec2(0.0, d.y));
  float gx = tR.a - tL.a;
  float gy = tD.a - tU.a;
  vec2 muv = u_mapRect.xy + uv * u_mapRect.zw;
  float slot = texture(u_map, clamp(muv, 0.0, 1.0)).r;
  float albedo = tex.a > 0.0 ? max(tex.r, max(tex.g, tex.b)) / tex.a : 0.0;
  float rim = smoothstep(0.15, 0.7, length(vec2(gx, gy))) * smoothstep(0.08, 0.4, albedo);
  vec3 rgb = tex.rgb;
  if (u_recolour > 0.5 && tex.a > 0.0) {
    vec3 hsl = rgb2hsl(tex.rgb / tex.a);
    vec3 target = vec3(0.0);
    float ref = -1.0;
    bool on = false;
    if (u_light.w > 0.5 && (u_light.w < 1.5 || hsl.y > GLOW_SAT)) { target = u_light.xyz; on = true; }
    bool inside = muv.x >= 0.0 && muv.x <= 1.0 && muv.y >= 0.0 && muv.y <= 1.0;
    int idx = int(floor(slot * 255.0 + 0.5)) - 1;
    for (int i = 0; i < 4; i++) {
      if (inside && i == idx && u_slotOn[i] > 0.5) { target = u_slots[i]; ref = u_slotRef[i]; on = true; }
    }
    if (on) rgb = recolour(hsl, target, ref) * tex.a;
  }
${TURN_LIGHT_STEP}  float alpha = tex.a;
${warp ? WARP_INTERIOR : ""}  vec4 color = vec4(rgb * u_gain + u_rim * rim * alpha, alpha) * u_opacity;${mask ? `
  color *= clamp(socketAt(v_mask), 0.0, 1.0);` : ""}
  o_color = color;
  float bright = smoothstep(BRIGHT_LO, BRIGHT_HI, max(color.r, max(color.g, color.b)));
  o_glow = u_emissive > 0.5 ? vec4(color.rgb * bright, color.a) : vec4(0.0, 0.0, 0.0, color.a);
}`;

const EXTRACT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
out vec4 o_color;
void main() {
  o_color = texture(u_src, v_uv);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_step;
out vec4 o_color;
const float W[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
void main() {
  vec4 sum = texture(u_src, v_uv) * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = u_step * float(i);
    sum += (texture(u_src, v_uv + o) + texture(u_src, v_uv - o)) * W[i];
  }
  o_color = sum;
}`;

// Additive glow on the premultiplied scene; the glow's own light also counts as coverage, so it
// shows over a transparent canvas.
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_glow;
uniform vec3 u_tint;
out vec4 o_color;
void main() {
  vec4 scene = texture(u_scene, v_uv);
  vec3 glow = texture(u_glow, v_uv).rgb * u_tint;
  float cover = max(glow.r, max(glow.g, glow.b));
  o_color = vec4(scene.rgb + glow, min(1.0, scene.a + cover));
}`;

type Uniforms<K extends string> = Record<K, WebGLUniformLocation | null>;

export interface Program<K extends string> {
  program: WebGLProgram;
  u: Uniforms<K>;
}

export const BASE_UNIFORMS = [
  "u_rect", "u_m", "u_res", "u_tex", "u_map", "u_texel", "u_opacity", "u_gain", "u_rim", "u_emissive",
  "u_recolour", "u_light", "u_mapRect", "u_slotOn", "u_slots", "u_slotRef", ...TURN_UNIFORMS,
] as const;
export type BaseUniform = (typeof BASE_UNIFORMS)[number];
const WARP_PROGRAM_UNIFORMS = [...BASE_UNIFORMS, ...WARP_UNIFORMS] as const;
export type WarpProgramUniform = (typeof WARP_PROGRAM_UNIFORMS)[number];
const IRIS_PROGRAM_UNIFORMS = [...BASE_UNIFORMS, "u_maskM", "u_mask0", "u_mask1", "u_mask2", "u_maskW", "u_turnEye"] as const;
export type IrisProgramUniform = (typeof IRIS_PROGRAM_UNIFORMS)[number];

export interface Programs {
  base: Program<BaseUniform>;
  /** The base program with the art mouth's warp (gl/warp.ts), for the head and jaw of a warp rig. */
  warp: Program<WarpProgramUniform>;
  /** The base program clipped by an eye's socket masks (face-control, gl/iris.ts), for iris layers. */
  iris: Program<IrisProgramUniform>;
  extract: Program<"u_src">;
  blur: Program<"u_src" | "u_step">;
  composite: Program<"u_scene" | "u_glow" | "u_tint">;
  /** Unit quad, 4 corners as a triangle strip at attribute 0. */
  quad: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer };
  /** The unit grid a turned head's layers are drawn with (gl/turn.ts), same attribute. */
  grid: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer };
}

function shader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const s = gl.createShader(type);
  if (s === null) throw new Error("avatar: createShader failed");
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s) ?? "";
    gl.deleteShader(s);
    throw new Error(`avatar: shader compile failed: ${log}`);
  }
  return s;
}

/** Compiles and links one program; shaders are deleted once linked. */
export function link<K extends string>(gl: WebGL2RenderingContext, vs: string, fs: string, names: readonly K[]): Program<K> {
  const v = shader(gl, gl.VERTEX_SHADER, vs);
  const f = shader(gl, gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.bindAttribLocation(program, 0, "a_corner");
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`avatar: program link failed: ${log}`);
  }
  const u = {} as Uniforms<K>;
  for (const name of names) u[name] = gl.getUniformLocation(program, name);
  return { program, u };
}

function createQuad(gl: WebGL2RenderingContext): Programs["quad"] {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buffer };
}

export function createPrograms(gl: WebGL2RenderingContext): Programs {
  return {
    base: link(gl, baseVs(false), baseFs(false), BASE_UNIFORMS),
    warp: link(gl, baseVs(true), baseFs(true), WARP_PROGRAM_UNIFORMS),
    iris: link(gl, baseVs(false, true), baseFs(false, true), IRIS_PROGRAM_UNIFORMS),
    extract: link(gl, QUAD_VS, EXTRACT_FS, ["u_src"]),
    blur: link(gl, QUAD_VS, BLUR_FS, ["u_src", "u_step"]),
    composite: link(gl, QUAD_VS, COMPOSITE_FS, ["u_scene", "u_glow", "u_tint"]),
    quad: createQuad(gl),
    grid: createTurnGrid(gl),
  };
}

export function deletePrograms(gl: WebGL2RenderingContext, p: Programs): void {
  for (const { program } of [p.base, p.warp, p.iris, p.extract, p.blur, p.composite]) gl.deleteProgram(program);
  gl.deleteVertexArray(p.quad.vao);
  gl.deleteBuffer(p.quad.buffer);
  gl.deleteVertexArray(p.grid.vao);
  gl.deleteBuffer(p.grid.buffer);
}
