// Depth turn and lighting in WebGL (perfection-pass V2): a head turn curves the head's layers and
// moves the light across the face, instead of only panning flat cards.
//
// The bend (req 3.1): every layer on the head (rig turn.ts `turnHead`: the head and whatever
// follows it) is drawn as a TURN_GRID x TURN_GRID vertex grid (one buffer, made once, shared by
// every layer and program) and each vertex's REST point q (rig canvas px) is moved, before the
// layer's own transform, by `turnAt(q) = (A, B) * w(q)`: w is a smooth bump, 1 at the face centre
// and 0 from TURN_REACH face radii out (`(1 - u^2)^2 (1 - v^2)^2`, C1), (A, B) the turn's shift;
// below the face it ends at the head layer's bottom edge at the latest, so the neck joint never
// opens on the body (which does not bend).
// So the face slides toward the turn and compresses on the far side while its outline and
// anything off the face stay put. One field in rest px for all layers keeps features glued: a
// point of the eye and the same point of the head move alike, the mouth warp, face patches and
// closed lids sample in rest px as before, and an iris is moved as its eye's point under it
// (u_turnEye maps the iris's socket uv back to eye rest px). Depth parallax still separates layers.
// At zero turn, with warp 0, or for a layer off the head, the shift is exactly zero, the plain
// unit quad is drawn, and no uniform is set (the state cache below), so the frame and its GL call
// log are today's.
//
// The light (req 3.2): replaces nothing at rest. The painted shading is taken as right for the face
// at rest; a turn rotates the surface normals (yaw about y, pitch about x) and each pixel's light is
// scaled by how much more or less of TURN_LIGHT_DIR it now catches: `1 + k (shade(R n) - shade(n))`,
// tinted by the look's rim colour where it brightens. The normal is the face ellipsoid's at the rest
// point, bent by the luminance gradient of the 4 rim taps the shader already takes (no new tap);
// the rim (alpha gradient, same taps) is scaled by the same rule with the edge's own normal, so it
// grows on the edge turning into the light and fades on the other. Multiplicative: no halo on alpha
// edges, recolouring the look recolours the light, shading stays painted. Eyes, irises and emissive
// layers keep their treatment (no light term); light 0 or no turn skips the branch: today's pixels.
import { PITCH_LIMIT_DEG, turnHead, turnLight, turnWarp, YAW_LIMIT_DEG, type Layer, type Look, type Rig, type TurnFace } from "@sr/rig";
import { hexToRgb } from "../render/frame.js";
import type { FrameClock } from "../render/types.js";

/** Grid cells per side of a bent layer. */
export const TURN_GRID = 32;
/** Vertices of the grid as one triangle strip (rows joined by degenerate triangles). */
export const TURN_GRID_VERTICES = TURN_GRID * 2 * (TURN_GRID + 1) + 2 * (TURN_GRID - 1);
/** The bump's reach, in face radii. */
export const TURN_REACH = 1.25;
/** The face centre's shift at warp 1 and full yaw / pitch, in face radii (x of rx, y of ry). */
export const TURN_SHIFT_X = 0.25;
export const TURN_SHIFT_Y = 0.15;
/** The key light, view space (x right, y down, z toward the viewer): upper left, in front. */
export const TURN_LIGHT_DIR: readonly [number, number, number] = (() => {
  const v = [-0.45, -0.55, 0.7];
  const n = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return [(v[0] ?? 0) / n, (v[1] ?? 0) / n, (v[2] ?? 0) / n] as const;
})();
/** Relight gain at light 1, rim gain over that, wrap of the shade, and the luminance bump. */
export const TURN_LIGHT_GAIN = 0.6;
export const TURN_RIM_GAIN = 2;
export const TURN_WRAP = 0.3;
export const TURN_BUMP = 0.6;

/** Vertex-shader part: the bump and the shift of a rest point. */
export const TURN_VS = `uniform vec4 u_turnFace;
uniform vec4 u_turnK;
uniform vec4 u_turnReach;
out vec2 v_rest;
vec2 turnAt(vec2 q) {
  vec2 n = (q - u_turnFace.xy) / vec2(u_turnReach.x, q.y < u_turnFace.y ? u_turnReach.y : u_turnReach.z);
  vec2 f = max(vec2(1.0) - n * n, vec2(0.0));
  f *= f;
  return u_turnK.xy * (f.x * f.y);
}`;

/** Fragment-shader part: the turned normal's change of light. */
export const TURN_FS = `in vec2 v_rest;
uniform vec4 u_turnFace;
uniform vec4 u_turnK;
uniform vec4 u_turnRot;
uniform vec4 u_turnLight;
uniform vec3 u_turnTint;
vec3 turnRot(vec3 n) {
  vec3 a = vec3(n.x * u_turnRot.y + n.z * u_turnRot.x, n.y, n.z * u_turnRot.y - n.x * u_turnRot.x);
  return vec3(a.x, a.y * u_turnRot.w + a.z * u_turnRot.z, a.z * u_turnRot.w - a.y * u_turnRot.z);
}
float turnShade(vec3 n) { return max(0.0, dot(n, u_turnLight.xyz) + ${TURN_WRAP.toFixed(4)}) / ${(1 + TURN_WRAP).toFixed(4)}; }
float turnDelta(vec3 n) { return turnShade(turnRot(n)) - turnShade(n); }`;

/**
 * The light step in the fragment shader, after the recolour: `rgb` (premultiplied) and `rim` are
 * updated; tR, tL, tD, tU are the 4 gradient taps, gx and gy the alpha gradient.
 */
export const TURN_LIGHT_STEP = `  if (u_turnK.z > 0.0) {
    vec2 e = (v_rest - u_turnFace.xy) / u_turnFace.zw;
    float r2 = dot(e, e);
    if (r2 > 0.9025) e *= 0.95 / sqrt(r2);
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    vec2 bump = ${TURN_BUMP.toFixed(4)} * vec2(dot(tR.rgb - tL.rgb, LUMA), dot(tD.rgb - tU.rgb, LUMA));
    vec3 n = normalize(vec3(e - bump, sqrt(max(0.0, 1.0 - dot(e, e)))));
    float lit = u_turnLight.w * turnDelta(n);
    rgb *= vec3(1.0) + lit * (lit > 0.0 ? u_turnTint : vec3(1.0));
    float g = length(vec2(gx, gy));
    if (g > 1e-4) rim *= max(0.0, 1.0 + ${TURN_RIM_GAIN.toFixed(4)} * u_turnLight.w * turnDelta(normalize(vec3(-gx, -gy, 0.5 * g))));
  }
`;

export const TURN_UNIFORMS = ["u_turnFace", "u_turnReach", "u_turnK", "u_turnRot", "u_turnLight", "u_turnTint"] as const;
export type TurnUniform = (typeof TURN_UNIFORMS)[number];
type Locations = Record<TurnUniform, WebGLUniformLocation | null>;

/** The unit grid as a triangle strip at attribute 0 (corners 0..1, like the unit quad). */
export function createTurnGrid(gl: WebGL2RenderingContext): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
  const data = new Float32Array(TURN_GRID_VERTICES * 2);
  let i = 0;
  const put = (x: number, y: number): void => {
    data[i++] = x / TURN_GRID;
    data[i++] = y / TURN_GRID;
  };
  for (let row = 0; row < TURN_GRID; row += 1) {
    if (row > 0) put(0, row);
    for (let col = 0; col <= TURN_GRID; col += 1) {
      put(col, row);
      put(col, row + 1);
    }
    if (row < TURN_GRID - 1) put(TURN_GRID, row + 1);
  }
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buffer };
}

/** One frame's turn: filled in place by `planTurn` (no allocation per frame). */
export interface TurnFrame {
  /** Some layer bends or is relit this frame. */
  active: boolean;
  /** Shift of the face centre, rest px (0 when warp is off). */
  shiftX: number;
  shiftY: number;
  /** Relight strength (light x TURN_LIGHT_GAIN), 0 off. */
  light: number;
  face: TurnFace;
  /** The bump's reach, rest px: sideways, above and below the face centre. */
  reachX: number;
  reachUp: number;
  reachDown: number;
  members: ReadonlySet<string>;
  sinYaw: number;
  cosYaw: number;
  sinPitch: number;
  cosPitch: number;
  /** Highlight tint from the look's rim colour (brightest channel 1, half way to white). */
  tint: [number, number, number];
}

export function createTurnFrame(): TurnFrame {
  return { active: false, shiftX: 0, shiftY: 0, light: 0, face: { cx: 0, cy: 0, rx: 1, ry: 1 }, reachX: 1, reachUp: 1, reachDown: 1, members: new Set(), sinYaw: 0, cosYaw: 1, sinPitch: 0, cosPitch: 1, tint: [1, 1, 1] };
}

/** Sets `out.tint` from the look's rim colour (called on a look change, not per frame). */
export function tintTurn(out: TurnFrame, look: Pick<Look, "palette">): void {
  const rgb = hexToRgb(look.palette.rim);
  const top = Math.max(rgb[0], rgb[1], rgb[2]);
  for (let c = 0; c < 3; c += 1) out.tint[c] = top > 0 ? 0.5 + (0.5 * (rgb[c] ?? 0)) / top : 1;
}

/** Fills `out` for this frame; `out.active` false = draw exactly as without a turn. */
export function planTurn(out: TurnFrame, rig: Rig, look: Pick<Look, "turn">, turn: FrameClock["turn"]): TurnFrame {
  out.active = false;
  const yaw = turn === undefined || !Number.isFinite(turn.yaw) ? 0 : Math.min(1, Math.max(-1, turn.yaw));
  const pitch = turn === undefined || !Number.isFinite(turn.pitch) ? 0 : Math.min(1, Math.max(-1, turn.pitch));
  const head = yaw === 0 && pitch === 0 ? undefined : turnHead(rig);
  if (head === undefined) return out;
  const warp = turnWarp(rig, look);
  const light = turnLight(rig, look);
  out.face = head.face;
  out.reachX = TURN_REACH * head.face.rx;
  out.reachUp = TURN_REACH * head.face.ry;
  out.reachDown = Math.max(0.25 * head.face.ry, Math.min(TURN_REACH * head.face.ry, head.head.bbox[1] + head.head.bbox[3] - head.face.cy));
  out.members = head.members;
  out.shiftX = warp * yaw * TURN_SHIFT_X * head.face.rx;
  out.shiftY = warp * pitch * TURN_SHIFT_Y * head.face.ry;
  out.light = light * TURN_LIGHT_GAIN;
  const a = (yaw * YAW_LIMIT_DEG * Math.PI) / 180;
  const b = (pitch * PITCH_LIMIT_DEG * Math.PI) / 180;
  out.sinYaw = Math.sin(a);
  out.cosYaw = Math.cos(a);
  out.sinPitch = Math.sin(b);
  out.cosPitch = Math.cos(b);
  out.active = out.shiftX !== 0 || out.shiftY !== 0 || out.light > 0;
  return out;
}

/** Whether `layer` takes the turn's light: on the head, not an eye, iris or emissive part. */
export const litByTurn = (layer: Pick<Layer, "kind">, emissive: boolean): boolean => !emissive && layer.kind !== "eye" && layer.kind !== "iris";

/** The values each linked program holds (a fresh program holds zeros), so unchanged ones are not re-set. */
const held = new WeakMap<object, Float64Array>();
const heldOf = (u: object): Float64Array => {
  let h = held.get(u);
  if (h === undefined) {
    h = new Float64Array(24);
    held.set(u, h);
  }
  return h;
};

/** Sets a vec4 at slot `at` of `u`'s held values only when it changed. */
/**
 * One reused vec4 (perfection-pass P1 rule: no allocation per draw): callers fill it, `set4` sends it
 * when it differs from what the program holds. Values are compared as sent (float32).
 */
const VEC4 = new Float32Array(4);

function set4(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null, h: Float64Array, at: number): void {
  if (h[at] === VEC4[0] && h[at + 1] === VEC4[1] && h[at + 2] === VEC4[2] && h[at + 3] === VEC4[3]) return;
  for (let i = 0; i < 4; i += 1) h[at + i] = VEC4[i] ?? 0;
  gl.uniform4fv(loc, VEC4);
}

function fill4(x: number, y: number, z: number, w: number): void {
  VEC4[0] = x;
  VEC4[1] = y;
  VEC4[2] = z;
  VEC4[3] = w;
}

/** The frame's shared turn uniforms on one program (only while the frame is active). */
export function setTurnFrame(gl: WebGL2RenderingContext, u: Locations, t: TurnFrame): void {
  const h = heldOf(u);
  fill4(t.face.cx, t.face.cy, t.face.rx, t.face.ry);
  set4(gl, u.u_turnFace, h, 4);
  fill4(t.reachX, t.reachUp, t.reachDown, 0);
  set4(gl, u.u_turnReach, h, 20);
  fill4(t.sinYaw, t.cosYaw, t.sinPitch, t.cosPitch);
  set4(gl, u.u_turnRot, h, 8);
  fill4(TURN_LIGHT_DIR[0], TURN_LIGHT_DIR[1], TURN_LIGHT_DIR[2], t.light);
  set4(gl, u.u_turnLight, h, 12);
  if (h[16] !== t.tint[0] || h[17] !== t.tint[1] || h[18] !== t.tint[2]) {
    h[16] = t.tint[0];
    h[17] = t.tint[1];
    h[18] = t.tint[2];
    gl.uniform3f(u.u_turnTint, t.tint[0], t.tint[1], t.tint[2]);
  }
}

/** The per-draw turn: `t`'s shift when `bend` (else none) and its light when `lit` (0/1). */
export function setTurnLayer(gl: WebGL2RenderingContext, u: Pick<Locations, "u_turnK">, t: TurnFrame | undefined, bend: boolean, lit: boolean): void {
  fill4(bend && t !== undefined ? t.shiftX : 0, bend && t !== undefined ? t.shiftY : 0, lit ? 1 : 0, 0);
  set4(gl, u.u_turnK, heldOf(u), 0);
}

/** Which unit VAO is bound during a layer pass (the quad, or the turn grid). */
let gridBound = false;

/** Binds the quad (at the start of a pass, `reset`) or, when it changes, the grid or the quad; its vertex count. */
export function bindStrip(gl: WebGL2RenderingContext, programs: { quad: { vao: WebGLVertexArrayObject }; grid: { vao: WebGLVertexArrayObject } }, bend: boolean, reset = false): number {
  if (reset) {
    gl.bindVertexArray(programs.quad.vao);
    gridBound = false;
  }
  if (bend !== gridBound) gl.bindVertexArray(bend ? programs.grid.vao : programs.quad.vao);
  gridBound = bend;
  return bend ? TURN_GRID_VERTICES : 4;
}
