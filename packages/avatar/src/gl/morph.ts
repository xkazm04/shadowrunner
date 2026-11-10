// Morph keys in WebGL (companion-lanes design "Shader"): the morph twin of the base layer program
// and the per-frame state that feeds it. The twin is the warp twin's vertex stage (its quad grown by
// `u_draw` so swayed pixels have room) and the base fragment with its texture read replaced by
// MORPH_SAMPLE below; recolour, gain, rim, turn bend and light, dim and the glow source then run on
// the morphed colour unchanged. It is linked on the first frame that needs it, so a rig without
// `morph` never compiles it.
//
// The math, in canvas px of the layer's rest frame (before its pose and the turn's bend):
//   x' = x - s(x) * amp * L                      sway: s the sway map at x, L the frame's lag
//   D(p) = sum_i w_i F_i(p)                       F_i key i's decoded flow, 0 outside its bbox
//   p = x' - D(x' - D(x'))                        two fixed-point steps of p = x' - D(p)
//   c = layer(p); per group g in order: S = sum w_i m_i, C = sum w_i m_i rgb_i / max(S, 1e-4)
//   at q_i = p + F_i(p); c.rgb = mix(c.rgb, C * c.a, min(1, S))
// The layer's 4 rim taps and the region map are read about p (the rim and the turn light's bump
// see the layer's own pixels there, not the keys'). The layer and atlas reads take the gradients of
// x (textureGrad), so a displaced read keeps the base pass's level of detail.
//
// Decisions the spec leaves open:
// - Textures (gl/textures.ts): the atlas is a "patch" (premultiplied, mipmapped like a layer; a
//   cell's 2 px gutter and its coverage fading to 0 at the edge keep neighbours out of the mips);
//   the motion image and the sway map are "flow" (as stored, linear). All three are asked of the
//   renderer's texture store at `setRig` (uploaded then, or when a lazy load lands) and die with it
//   (a new rig, `dispose`, a lost context): the layer textures' lifecycle.
// - Until the atlas is ready the layer draws with the base program; a motion image or sway map not
//   ready yet makes its keys plain cross-fades and the sway still.
// - Units 2-4 hold the atlas, the motion image and the sway map (the iris program's mask units;
//   both bind before each draw and drawLayers unbinds them after the pass).
import { morphGroupIndex, MORPH_MAX_ACTIVE, type Rig, type RigMorph } from "@sr/rig";
import type { MorphFrame } from "../render/types.js";
import { BASE_UNIFORMS, baseFs, baseVs, link, type LayerSample, type Program } from "./programs.js";
import type { GlTexture, TextureStore } from "./textures.js";

const N = MORPH_MAX_ACTIVE;

const MORPH_DECL = `uniform sampler2D u_atlas;
uniform sampler2D u_flow;
uniform sampler2D u_sway;
uniform vec2 u_atlasTexel;
uniform vec2 u_flowTexel;
uniform vec4 u_swayK;
uniform vec4 u_swayBox;
uniform int u_kCount;
uniform vec4 u_kBox[${N}];
uniform vec4 u_kCell[${N}];
uniform vec4 u_kFlow[${N}];
uniform vec4 u_kParam[${N}];
float inLayer(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 ? 1.0 : 0.0; }
vec2 kAt(int i, vec2 p) { return (p - u_kBox[i].xy) / u_kBox[i].zw; }
bool kIn(vec2 k) { return k.x >= 0.0 && k.x <= 1.0 && k.y >= 0.0 && k.y <= 1.0; }
vec2 kFlow(int i, vec2 p) {
  if (u_kParam[i].y <= 0.0) return vec2(0.0);
  vec2 k = kAt(i, p);
  if (!kIn(k)) return vec2(0.0);
  vec2 code = textureLod(u_flow, (u_kFlow[i].xy + k * u_kFlow[i].zw) * u_flowTexel, 0.0).rg;
  return (code * 255.0 - 128.0) / 127.0 * u_kParam[i].y;
}
vec2 mDisp(vec2 p) {
  vec2 d = vec2(0.0);
  for (int i = 0; i < ${N}; i++) {
    if (i >= u_kCount) break;
    d += u_kParam[i].x * kFlow(i, p);
  }
  return d;
}`;

const MORPH_SAMPLE = `  vec2 x = u_rect.xy + v_uv * u_rect.zw;
  vec2 gdx = dFdx(x);
  vec2 gdy = dFdy(x);
  if (u_swayK.z > 0.0) {
    vec2 su = (x - u_swayBox.xy) / u_swayBox.zw;
    x -= inLayer(su) * textureLod(u_sway, su, 0.0).r * u_swayK.xy;
  }
  vec2 p = x - mDisp(x);
  p = x - mDisp(p);
  vec2 uv = (p - u_rect.xy) / u_rect.zw;
  vec4 tex = textureGrad(u_tex, uv, gdx / u_rect.zw, gdy / u_rect.zw) * inLayer(uv);
  for (int g = 0; g < 4; g++) {
    float s = 0.0;
    vec3 c = vec3(0.0);
    for (int i = 0; i < ${N}; i++) {
      if (i >= u_kCount) break;
      if (int(u_kParam[i].z + 0.5) != g) continue;
      vec2 k = kAt(i, p + kFlow(i, p));
      if (!kIn(k)) continue;
      vec2 r = u_kCell[i].zw / u_kBox[i].zw * u_atlasTexel;
      vec4 t = textureGrad(u_atlas, (u_kCell[i].xy + k * u_kCell[i].zw) * u_atlasTexel, gdx * r, gdy * r);
      s += u_kParam[i].x * t.a;
      c += u_kParam[i].x * t.rgb;
    }
    if (s > 0.0) tex.rgb = mix(tex.rgb, c / max(s, 1e-4) * tex.a, min(1.0, s));
  }`;

/** The base fragment's texture read, replaced (gl/programs.ts `baseFs`). */
export const MORPH_LAYER_SAMPLE: LayerSample = { decl: MORPH_DECL, sample: MORPH_SAMPLE };

export const MORPH_UNIFORMS = [
  ...BASE_UNIFORMS, "u_draw", "u_atlas", "u_flow", "u_sway", "u_atlasTexel", "u_flowTexel", "u_swayK", "u_swayBox",
  "u_kCount", "u_kBox", "u_kCell", "u_kFlow", "u_kParam",
] as const;
export type MorphUniform = (typeof MORPH_UNIFORMS)[number];

/** What drawLayers needs to draw the morph layer this frame (one object per renderer, refilled). */
export interface MorphDraw {
  /** The morph layer's name. */
  layer: string;
  program: Program<MorphUniform>;
  /** Binds the textures (units 2-4) and sets the frame's morph uniforms on the bound program. */
  bind(gl: WebGL2RenderingContext): void;
  /** `u_draw` for one quad: its rect grown by the sway's reach. */
  rect(gl: WebGL2RenderingContext, rect: readonly number[]): void;
}

export interface MorphGl {
  /** The rig's morph textures, asked of `store` (uploaded now, or once a lazy load lands). */
  setRig(rig: Rig, store: TextureStore): void;
  /** This frame's morph draw, or undefined: draw the morph layer with the base program. */
  frame(frame: MorphFrame | undefined): MorphDraw | undefined;
  /** Deletes the program (the textures belong to the store). */
  dispose(): void;
}

export function createMorphGl(gl: WebGL2RenderingContext): MorphGl {
  let program: Program<MorphUniform> | undefined;
  let morph: RigMorph | undefined;
  let layerBox: readonly number[] = [0, 0, 1, 1];
  let store: TextureStore | undefined;
  const box = new Float32Array(4 * N);
  const cell = new Float32Array(4 * N);
  const flowCell = new Float32Array(4 * N);
  const param = new Float32Array(4 * N);
  let count = 0;
  let reach = 0;
  let swayX = 0;
  let swayY = 0;
  let atlas: GlTexture | undefined;
  let flow: GlTexture | undefined;
  let sway: GlTexture | undefined;

  const bindUnit = (unit: number, texture: GlTexture | undefined, loc: WebGLUniformLocation | null): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture?.texture ?? atlas?.texture ?? null);
    gl.uniform1i(loc, unit);
  };

  let draw: MorphDraw | undefined;
  const methods = {
    bind(): void {
      if (program === undefined) return;
      const { u } = program;
      bindUnit(2, atlas, u.u_atlas);
      bindUnit(3, flow, u.u_flow);
      bindUnit(4, sway, u.u_sway);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u.u_atlasTexel, atlas?.texel[0] ?? 1, atlas?.texel[1] ?? 1);
      gl.uniform2f(u.u_flowTexel, flow?.texel[0] ?? 1, flow?.texel[1] ?? 1);
      gl.uniform4f(u.u_swayK, swayX, swayY, sway === undefined ? 0 : 1, 0);
      gl.uniform4f(u.u_swayBox, layerBox[0] ?? 0, layerBox[1] ?? 0, layerBox[2] ?? 1, layerBox[3] ?? 1);
      gl.uniform1i(u.u_kCount, count);
      gl.uniform4fv(u.u_kBox, box);
      gl.uniform4fv(u.u_kCell, cell);
      gl.uniform4fv(u.u_kFlow, flowCell);
      gl.uniform4fv(u.u_kParam, param);
    },
    rect(_gl: WebGL2RenderingContext, rect: readonly number[]): void {
      if (program === undefined) return;
      gl.uniform4f(program.u.u_draw, (rect[0] ?? 0) - reach, (rect[1] ?? 0) - reach, (rect[2] ?? 0) + 2 * reach, (rect[3] ?? 0) + 2 * reach);
    },
  };

  return {
    setRig(rig, next) {
      store = next;
      morph = rig.morph;
      layerBox = rig.layers.find((l) => l.name === morph?.layer)?.bbox ?? [0, 0, 1, 1];
      if (morph === undefined) return;
      next.get(morph.atlas, "patch");
      if (morph.flow !== undefined) next.get(morph.flow, "flow");
      if (morph.sway !== undefined) next.get(morph.sway.map, "flow");
    },
    frame(f) {
      if (f === undefined || morph === undefined || store === undefined || f.plan.morph !== morph) return undefined;
      atlas = store.get(morph.atlas, "patch");
      if (atlas === undefined) return undefined;
      flow = morph.flow === undefined ? undefined : store.get(morph.flow, "flow");
      const map = morph.sway === undefined ? undefined : store.get(morph.sway.map, "flow");
      const amp = morph.sway?.amp ?? 0;
      sway = map !== undefined && (f.sway.x !== 0 || f.sway.y !== 0) ? map : undefined;
      swayX = sway === undefined ? 0 : amp * f.sway.x;
      swayY = sway === undefined ? 0 : amp * f.sway.y;
      reach = sway === undefined ? 0 : Math.ceil(Math.max(Math.abs(swayX), Math.abs(swayY))) + 1;
      const { plan } = f;
      if (plan.count === 0 && sway === undefined) return undefined;
      count = Math.min(N, plan.count);
      box.fill(0);
      cell.fill(0);
      flowCell.fill(0);
      param.fill(0);
      for (let n = 0; n < count; n += 1) {
        const key = morph.keys[plan.active[n] ?? 0];
        if (key === undefined) continue;
        for (let c = 0; c < 4; c += 1) {
          box[4 * n + c] = key.bbox[c] ?? 0;
          cell[4 * n + c] = key.cell[c] ?? 0;
          flowCell[4 * n + c] = key.flowCell?.[c] ?? 0;
        }
        param[4 * n] = plan.weights[plan.active[n] ?? 0] ?? 0;
        param[4 * n + 1] = flow !== undefined && key.flowCell !== undefined ? (key.flowMax ?? 0) : 0;
        param[4 * n + 2] = morphGroupIndex(key.track);
      }
      program ??= link(gl, baseVs(true), baseFs(false, false, MORPH_LAYER_SAMPLE), MORPH_UNIFORMS);
      if (draw?.program !== program) draw = { layer: morph.layer, program, ...methods };
      draw.layer = morph.layer;
      return draw;
    },
    dispose() {
      if (program !== undefined) gl.deleteProgram(program.program);
      program = undefined;
      draw = undefined;
    },
  };
}
