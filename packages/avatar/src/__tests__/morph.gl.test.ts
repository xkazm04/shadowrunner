// Morph keys in the GL renderer (companion-lanes requirement 3, gl/morph.ts) against the counting
// stub: the morph program is linked on first need and used exactly while a key is active or the sway
// is on, with the uniforms of a known plan; the atlas is uploaded premultiplied and the motion image
// and sway map as stored, linear; the textures follow the layer textures' lifecycle; a rig without
// `morph` links no extra program.
import { defaultLook, FACE_DEFAULTS, morphPlan, poseLayers, type Drive, type MorphInputs, type Rig, type RigMorph } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../gl/renderer.js";
import type { FrameClock, MorphFrame } from "../render/types.js";
import { createCanvasStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";
import { morphAssets, morphRig } from "./morphRig.js";

const DRIVE: Drive = { t: 1, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
type Call = GlStub["log"][number];
const named = (call: Call): string | undefined => (call[1][0] as { uniform?: string } | null)?.uniform;
const uniform = (log: readonly Call[], name: string): unknown[][] => log.filter((c) => c[0].startsWith("uniform") && named(c) === name).map((c) => c[1].slice(1));

function frameOf(morph: RigMorph, inputs: Partial<MorphInputs>, sway = { x: 0, y: 0 }): MorphFrame {
  return { plan: morphPlan(morph, { blink: 0, emotion: "neutral", face: FACE_DEFAULTS, ...inputs }), sway };
}

function setup(rig: Rig = morphRig()) {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 256, height: 256 }).canvas, rig, morphAssets(rig));
  const look = defaultLook(rig);
  const poses = poseLayers(rig, look, DRIVE);
  const draw = (morph?: MorphFrame): Call[] => {
    stub.reset();
    const clock: FrameClock = { t: 1, reducedMotion: false, ...(morph === undefined ? {} : { morph }) };
    renderer.draw(poses, look, clock);
    return stub.log.map(([n, a]) => [n, [...a]]);
  };
  return { stub, renderer, rig, draw };
}

/** The program a log's `getUniformLocation(_, "u_kCount")` was asked of: the morph program. */
const morphProgramIn = (log: readonly Call[]): unknown => log.find(([n, a]) => n === "getUniformLocation" && a[1] === "u_kCount")?.[1][0];

describe("the morph program", () => {
  it("is linked on the first frame with a key on, used exactly while a key is active or the sway is on", () => {
    const { rig, draw } = setup();
    const morph = rig.morph as RigMorph;
    const before = draw();
    expect(before.filter(([n]) => n === "createProgram")).toHaveLength(0);
    const on = draw(frameOf(morph, { blink: 1 }));
    expect(on.filter(([n]) => n === "createProgram")).toHaveLength(1);
    const program = morphProgramIn(on);
    expect(program).toBeDefined();
    expect(on.filter(([n, a]) => n === "useProgram" && a[0] === program)).toHaveLength(1);
    // Rest after: base program only, no morph uniform, no new link.
    for (const log of [draw(frameOf(morph, {})), draw()]) {
      expect(log.filter(([n]) => n === "createProgram")).toHaveLength(0);
      expect(log.filter(([n, a]) => n === "useProgram" && a[0] === program)).toHaveLength(0);
      expect(uniform(log, "u_kCount")).toEqual([]);
    }
    const swaying = draw(frameOf(morph, {}, { x: 0.5, y: -0.25 }));
    expect(swaying.filter(([n, a]) => n === "useProgram" && a[0] === program)).toHaveLength(1);
    expect(uniform(swaying, "u_kCount")).toEqual([[0]]);
    expect(uniform(swaying, "u_swayK")).toEqual([[3, -1.5, 1, 0]]);
    // u_draw: the head's bbox grown by the sway's reach (ceil(3) + 1 px).
    expect(uniform(swaying, "u_draw")).toEqual([[56, 26, 148, 188]]);
    expect(uniform(swaying, "u_swayBox")).toEqual([[60, 30, 140, 180]]);
  });

  it("carries the plan: count, boxes, cells, flow cells, weight / flowMax / group, compositing order", () => {
    const { rig, draw } = setup();
    const morph = rig.morph as RigMorph;
    const log = draw(frameOf(morph, { blink: 1, emotion: "amused", shapes: { openMid: 0.6, round: 0.2 } }));
    expect(uniform(log, "u_kCount")).toEqual([[4]]);
    const pad = (rows: number[][]): number[] => [...rows.flat(), ...new Array<number>(4 * (8 - rows.length)).fill(0)];
    // joy (face 0), open_mid and round (mouth 2), blink (3).
    expect(uniform(log, "u_kBox")).toEqual([[pad([[70, 70, 120, 130], [100, 150, 60, 40], [100, 150, 60, 40], [80, 90, 100, 30]])]]);
    expect(uniform(log, "u_kCell")).toEqual([[pad([[0, 88, 120, 130], [104, 0, 60, 40], [104, 44, 60, 40], [0, 34, 100, 30]])]]);
    expect(uniform(log, "u_kFlow")).toEqual([[pad([[44, 0, 30, 33], [27, 0, 15, 10], [0, 0, 0, 0], [0, 0, 0, 0]])]]);
    // Round 2: the back cell of the key that has one (joy has none: the forward motion alone).
    expect(uniform(log, "u_kBack")).toEqual([[pad([[0, 0, 0, 0], [27, 12, 15, 10], [0, 0, 0, 0], [0, 0, 0, 0]])]]);
    expect(uniform(log, "u_kParam")).toEqual([[pad([[1, 2, 0, 0], [Math.fround(0.6), 6, 2, 0], [Math.fround(0.2), 0, 2, 0], [1, 0, 3, 0]])]]);
    expect(uniform(log, "u_swayK")).toEqual([[0, 0, 0, 0]]);
    expect(uniform(log, "u_atlasTexel")).toEqual([[1 / 256, 1 / 256]]);
    expect(uniform(log, "u_flowTexel")).toEqual([[1 / 128, 1 / 64]]);
    expect(uniform(log, "u_atlas")).toEqual([[2]]);
    expect(uniform(log, "u_flow")).toEqual([[3]]);
    expect(uniform(log, "u_sway")).toEqual([[4]]);
    // Only the head's quad takes the morph program: its u_draw is its own bbox (no sway reach).
    expect(uniform(log, "u_draw")).toEqual([[60, 30, 140, 180]]);
  });

  it("uploads the atlas premultiplied and mipmapped, the motion image and sway map as stored and linear", () => {
    const stub = createGlStub();
    const rig = morphRig();
    createRenderer(createCanvasStub({ webgl2: stub }).canvas, rig, morphAssets(rig));
    const gl = stub.gl;
    // Each upload: its unpack state, then texImage2D, then (mipmaps or not) its filters.
    const uploads: { premultiply: unknown; colour: unknown; mip: boolean; min: unknown }[] = [];
    let premultiply: unknown;
    let colour: unknown = gl.BROWSER_DEFAULT_WEBGL;
    for (const [n, a] of stub.log) {
      if (n === "pixelStorei" && a[0] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) premultiply = a[1];
      if (n === "pixelStorei" && a[0] === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) colour = a[1];
      if (n === "texImage2D" && a.length === 6) uploads.push({ premultiply, colour, mip: false, min: undefined });
      const last = uploads.at(-1);
      if (n === "generateMipmap" && last !== undefined) last.mip = true;
      if (n === "texParameteri" && a[1] === gl.TEXTURE_MIN_FILTER && last !== undefined) last.min = a[2];
    }
    // 3 layers, then the atlas, the motion image, the sway map.
    expect(uploads.slice(-3)).toEqual([
      { premultiply: true, colour: gl.BROWSER_DEFAULT_WEBGL, mip: true, min: gl.LINEAR_MIPMAP_LINEAR },
      { premultiply: false, colour: gl.NONE, mip: false, min: gl.LINEAR },
      { premultiply: false, colour: gl.NONE, mip: false, min: gl.LINEAR },
    ]);
    // The unpack state is put back for the next layer upload.
    expect(stub.log.filter(([n, a]) => n === "pixelStorei" && a[0] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL).at(-1)?.[1][1]).toBe(true);
    expect(stub.log.filter(([n, a]) => n === "pixelStorei" && a[0] === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL).at(-1)?.[1][1]).toBe(gl.BROWSER_DEFAULT_WEBGL);
  });

  it("keys draw as plain cross-fades until the motion image is ready; no draw with the morph program until the atlas is", () => {
    const rig = morphRig();
    const morph = rig.morph as RigMorph;
    const assets = Object.fromEntries(Object.entries(morphAssets(rig)).filter(([file]) => file !== morph.flow));
    const stub = createGlStub();
    const renderer = createRenderer(createCanvasStub({ webgl2: stub }).canvas, rig, assets);
    const look = defaultLook(rig);
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 1, reducedMotion: false, morph: frameOf(morph, { shapes: { openMid: 1 } }) });
    expect(uniform(stub.log, "u_kParam")[0]?.[0]).toEqual([1, 0, 2, 0, ...new Array<number>(28).fill(0)]);
    const noAtlas = Object.fromEntries(Object.entries(morphAssets(rig)).filter(([file]) => file !== morph.atlas));
    const bare = createGlStub();
    const r2 = createRenderer(createCanvasStub({ webgl2: bare }).canvas, rig, noAtlas);
    r2.draw(poseLayers(rig, look, DRIVE), look, { t: 1, reducedMotion: false, morph: frameOf(morph, { blink: 1 }) });
    expect(bare.count("createProgram")).toBe(6);
  });

  it("frees the program and the morph textures on dispose, and the textures on a new rig", () => {
    const { stub, renderer, rig, draw } = setup();
    draw(frameOf(rig.morph as RigMorph, { blink: 1 }));
    const textures = (): number => [...stub.live].filter((h) => (h as { kind?: string }).kind === "Texture").length;
    const withMorph = textures();
    const plain: Rig = { ...rig };
    delete plain.morph;
    renderer.setRig(plain, morphAssets(plain));
    expect(textures()).toBe(withMorph - 3);
    renderer.dispose();
    expect(stub.live.size).toBe(0);
  });

  it("after a lost and restored context the new renderer uploads the morph textures again and links the program on need", () => {
    const rig = morphRig();
    const stub = createGlStub();
    const host = createCanvasStub({ webgl2: stub, width: 256, height: 256 });
    const renderer = createRenderer(host.canvas, rig, morphAssets(rig), { replaceCanvas: () => null });
    host.loseContext();
    expect(renderer.info().mode).toBe("2d");
    stub.reset();
    host.restoreContext();
    expect(renderer.info().mode).toBe("webgl2");
    // 3 layers + the atlas, the motion image and the sway map.
    expect(stub.log.filter(([n, a]) => n === "texImage2D" && a.length === 6)).toHaveLength(6);
    const look = defaultLook(rig);
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 1, reducedMotion: false, morph: frameOf(rig.morph as RigMorph, { blink: 1 }) });
    expect(stub.count("createProgram")).toBe(7);
  });

  it("a rig without morph links the usual 6 programs and draws as before", () => {
    const stub = createGlStub();
    const rig = malakorRig();
    const renderer = createRenderer(createCanvasStub({ webgl2: stub }).canvas, rig, fakeAssets(rig));
    const look = defaultLook(rig);
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 1, reducedMotion: false });
    expect(stub.count("createProgram")).toBe(6);
    expect(stub.log.some(([n, a]) => n === "getUniformLocation" && a[1] === "u_kCount")).toBe(false);
  });
});
