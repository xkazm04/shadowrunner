// Shader sources and compile/link (avatar-renderer task 3.2): the base layer program (writes the
// colour and the glow source in one pass, two render targets), and three full-screen programs for
// the glow: extract (downsample to half res), blur (one axis of a separable 9-tap Gaussian),
// composite (scene + tinted glow onto the canvas). All share one unit-quad buffer.

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// Unit corner -> the layer's rest bbox in rig px -> device px (u_m, an affine) -> clip space.
const BASE_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
uniform vec4 u_rect;
uniform mat3 u_m;
uniform vec2 u_res;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  vec2 device = (u_m * vec3(u_rect.xy + a_corner * u_rect.zw, 1.0)).xy;
  gl_Position = vec4(device.x / u_res.x * 2.0 - 1.0, 1.0 - device.y / u_res.y * 2.0, 0.0, 1.0);
}`;

// Premultiplied texel x light gain, plus a rim term: smoothstep on the alpha gradient (4 taps),
// kept inside the layer by its own alpha and weighted by the texel's own brightness, so the black
// fill around cut parts (straight cut lines, inpaint patches) never draws a lit outline.
// Emissive layers also write their bright parts (a bright-pass on the lit colour) to the glow
// source; other layers write their alpha there, so whatever is in front occludes the glow.
const BASE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_opacity;
uniform vec3 u_gain;
uniform vec3 u_rim;
uniform float u_emissive;
const float BRIGHT_LO = 0.3;
const float BRIGHT_HI = 0.7;
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_glow;
void main() {
  vec4 tex = texture(u_tex, v_uv);
  vec2 d = u_texel * 2.0;
  float gx = texture(u_tex, v_uv + vec2(d.x, 0.0)).a - texture(u_tex, v_uv - vec2(d.x, 0.0)).a;
  float gy = texture(u_tex, v_uv + vec2(0.0, d.y)).a - texture(u_tex, v_uv - vec2(0.0, d.y)).a;
  float albedo = tex.a > 0.0 ? max(tex.r, max(tex.g, tex.b)) / tex.a : 0.0;
  float rim = smoothstep(0.15, 0.7, length(vec2(gx, gy))) * smoothstep(0.08, 0.4, albedo);
  vec4 color = vec4(tex.rgb * u_gain + u_rim * rim * tex.a, tex.a) * u_opacity;
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

export interface Programs {
  base: Program<"u_rect" | "u_m" | "u_res" | "u_tex" | "u_texel" | "u_opacity" | "u_gain" | "u_rim" | "u_emissive">;
  extract: Program<"u_src">;
  blur: Program<"u_src" | "u_step">;
  composite: Program<"u_scene" | "u_glow" | "u_tint">;
  /** Unit quad, 4 corners as a triangle strip at attribute 0. */
  quad: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer };
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
function link<K extends string>(gl: WebGL2RenderingContext, vs: string, fs: string, names: readonly K[]): Program<K> {
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
    base: link(gl, BASE_VS, BASE_FS, ["u_rect", "u_m", "u_res", "u_tex", "u_texel", "u_opacity", "u_gain", "u_rim", "u_emissive"]),
    extract: link(gl, QUAD_VS, EXTRACT_FS, ["u_src"]),
    blur: link(gl, QUAD_VS, BLUR_FS, ["u_src", "u_step"]),
    composite: link(gl, QUAD_VS, COMPOSITE_FS, ["u_scene", "u_glow", "u_tint"]),
    quad: createQuad(gl),
  };
}

export function deletePrograms(gl: WebGL2RenderingContext, p: Programs): void {
  for (const { program } of [p.base, p.extract, p.blur, p.composite]) gl.deleteProgram(program);
  gl.deleteVertexArray(p.quad.vao);
  gl.deleteBuffer(p.quad.buffer);
}
