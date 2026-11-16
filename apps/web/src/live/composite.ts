// Matted frames on the out canvas (spec flashhead-live, round 2: `0x04`): the colour JPEG and the
// greyscale alpha JPEG are decoded apart, and the alpha's luminance becomes the canvas alpha, so
// the OBS page stays transparent where the matte says background. A tiny WebGL shader does it on
// the GPU (two texture uploads and one quad per frame); without WebGL, a CPU pass over the pixels.
// Both paths share one rule: the JPEG noise floor (alpha <= 2 or >= 253) snaps to fully clear or
// fully opaque, so compression ringing never leaves a faint veil over the background.

export type CompositeKind = "webgl" | "cpu";

export interface Compositor {
  readonly kind: CompositeKind;
  /** Draws `color` with `alpha`'s luminance as its alpha onto `ctx` at the origin, replacing what was there. */
  draw(ctx: CanvasRenderingContext2D, color: ImageBitmap, alpha: ImageBitmap): void;
  dispose(): void;
}

export const ALPHA_FLOOR = 2;
export const ALPHA_CEIL = 253;

/** One alpha byte through the noise floor: <= FLOOR is 0, >= CEIL is 255, linear between. */
export function alphaRemap(value: number): number {
  const t = (value - ALPHA_FLOOR) / (ALPHA_CEIL - ALPHA_FLOOR);
  return Math.round(255 * Math.min(1, Math.max(0, t)));
}

const REMAP = Uint8ClampedArray.from({ length: 256 }, (_, v) => alphaRemap(v));

/** The CPU path: RGBA `color` takes its alpha from the red channel of RGBA `alpha` (same size). */
export function applyAlpha(color: Uint8ClampedArray, alpha: Uint8ClampedArray): void {
  const n = Math.min(color.length, alpha.length);
  for (let i = 3; i < n; i += 4) color[i] = REMAP[alpha[i - 3] ?? 0] ?? 0;
}

type Scratch = OffscreenCanvas | HTMLCanvasElement;

function scratch(): Scratch {
  return typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
}

function fit(canvas: Scratch, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

const VERTEX = `attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `precision mediump float;
uniform sampler2D color;
uniform sampler2D alpha;
varying vec2 uv;
void main() {
  float a = clamp((texture2D(alpha, uv).r * 255.0 - ${ALPHA_FLOOR}.0) / ${ALPHA_CEIL - ALPHA_FLOOR}.0, 0.0, 1.0);
  gl_FragColor = vec4(texture2D(color, uv).rgb * a, a);
}`;

type GL = WebGLRenderingContext;

function program(gl: GL): WebGLProgram | undefined {
  const made = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) return undefined;
    gl.attachShader(made, shader);
  }
  gl.linkProgram(made);
  return gl.getProgramParameter(made, gl.LINK_STATUS) === true ? made : undefined;
}

function texture(gl: GL, unit: number): WebGLTexture {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

/** The GPU path, or undefined when WebGL is not available here. */
function webglCompositor(): Compositor | undefined {
  const canvas = scratch();
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true }) as GL | null;
  if (gl === null) return undefined;
  const prog = program(gl);
  if (prog === undefined) return undefined;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const textures = [texture(gl, 0), texture(gl, 1)] as const;
  gl.uniform1i(gl.getUniformLocation(prog, "color"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "alpha"), 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  let lost: Compositor | undefined;
  return {
    kind: "webgl",
    draw(ctx, color, alpha) {
      // A lost context (driver reset, too many contexts) carries on on the CPU.
      if (lost !== undefined || gl.isContextLost()) return (lost ??= cpuCompositor()).draw(ctx, color, alpha);
      fit(canvas, color.width, color.height);
      gl.viewport(0, 0, color.width, color.height);
      [color, alpha].forEach((bitmap, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textures[unit] ?? null);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.drawImage(canvas, 0, 0);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** The CPU path: two scratch canvases and one pass over the pixels. */
function cpuCompositor(): Compositor {
  const a = scratch();
  const b = scratch();
  const read = (canvas: Scratch, bitmap: ImageBitmap): ImageData | undefined => {
    fit(canvas, bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (ctx === null) return undefined;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  return {
    kind: "cpu",
    draw(ctx, color, alpha) {
      const rgb = read(a, color);
      const mask = read(b, alpha);
      if (rgb === undefined || mask === undefined) return;
      applyAlpha(rgb.data, mask.data);
      ctx.putImageData(rgb, 0, 0);
    },
    dispose() {
      fit(a, 1, 1);
      fit(b, 1, 1);
    },
  };
}

/** WebGL when it can be had, else the CPU pass. */
export function createCompositor(): Compositor {
  try {
    return webglCompositor() ?? cpuCompositor();
  } catch {
    return cpuCompositor();
  }
}
