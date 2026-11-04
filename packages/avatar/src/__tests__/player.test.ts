// @vitest-environment happy-dom
// The React-free player (spec avatar-reach, design "Player core" / "Testing"): a fake renderer
// through runPlayer's factory seam, a hand-driven requestAnimationFrame, and spies on the frame
// inputs (advanceFrame) and the Drive handed to poseLayers.
import * as rigModule from "@sr/rig";
import { defaultLook, GESTURE_DURATION_S, MOOD_FADE_S, type Drive, type Look } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameInputs } from "../react/loop.js";
import { BACKDROP_LAYER, cutoutLook } from "../player/cutout.js";
import { createAvatarPlayer } from "../player/player.js";
import { runPlayer, type RendererFactory } from "../player/run.js";
import type { FrameClock, Renderer } from "../render/types.js";
import { createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const seen = vi.hoisted(() => ({ inputs: [] as FrameInputs[], drives: [] as Drive[] }));

vi.mock("../react/loop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../react/loop.js")>();
  return {
    ...actual,
    advanceFrame: (state: Parameters<typeof actual.advanceFrame>[0], inputs: FrameInputs) => {
      seen.inputs.push(inputs);
      return actual.advanceFrame(state, inputs);
    },
  };
});

vi.mock("@sr/rig", async (importOriginal) => {
  const actual = await importOriginal<typeof rigModule>();
  return {
    ...actual,
    poseLayers: (...args: Parameters<typeof actual.poseLayers>) => {
      seen.drives.push(args[2]);
      return actual.poseLayers(...args);
    },
  };
});

const rig = malakorRig();
const assets = fakeAssets(rig);
const look: Look = defaultLook(rig);

interface FakeRenderer extends Renderer {
  draws: { look: Look; clock: FrameClock | undefined; poses: number }[];
  resizes: [number, number, number][];
  disposed: number;
}

function fakeRenderer(): { factory: RendererFactory; renderer: FakeRenderer } {
  const renderer: FakeRenderer = {
    draws: [],
    resizes: [],
    disposed: 0,
    setRig: () => undefined,
    setLook: () => undefined,
    draw(poses, l, clock) {
      renderer.draws.push({ look: l, clock, poses: poses.length });
    },
    resize(w, h, dpr) {
      renderer.resizes.push([w, h, dpr]);
    },
    info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
    dispose() {
      renderer.disposed += 1;
    },
  };
  return { factory: () => renderer, renderer };
}

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let cancelled: number[];
let reduceQuery: boolean;

function tick(now: number): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

function canvasIn(width = 300, height = 200): HTMLCanvasElement {
  const host = document.createElement("div");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ width, height } as DOMRect);
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

beforeEach(() => {
  seen.inputs.length = 0;
  seen.drives.length = 0;
  frames = new Map();
  nextId = 1;
  cancelled = [];
  reduceQuery = false;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    cancelled.push(id);
    frames.delete(id);
  });
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = new window.EventTarget() as MediaQueryList;
    Object.defineProperty(list, "matches", { get: () => reduceQuery && query.includes("reduce") });
    return list;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-motion");
});

describe("createAvatarPlayer", () => {
  it("steps and draws one frame per renderFrame, on the driver clock", () => {
    const { factory, renderer } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.renderFrame(0.05);
    player.renderFrame(0.05);
    expect(renderer.draws).toHaveLength(2);
    // The cutout hides the backdrop layer, so it is not posed.
    expect(renderer.draws[0]?.poses).toBe(rig.layers.length - 1);
    expect(renderer.draws[1]?.clock?.t).toBeCloseTo(0.1, 9);
    expect(seen.inputs.map((i) => i.dt)).toEqual([0.05, 0.05]);
  });

  it("draws a cutout: the backdrop layer is hidden unless backdrop is kept, also after setLook", () => {
    const { factory, renderer } = fakeRenderer();
    expect(rig.layers.some((l) => l.name === BACKDROP_LAYER)).toBe(true);
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.renderFrame(0.05);
    player.setLook({ ...look, hidden: [] });
    player.renderFrame(0.05);
    for (const draw of renderer.draws) expect(draw.look.hidden).toContain(BACKDROP_LAYER);
    const kept = fakeRenderer();
    runPlayer(canvasIn(), { rig, look, assets, backdrop: true }, kept.factory).renderFrame(0.05);
    expect(kept.renderer.draws[0]?.look.hidden).not.toContain(BACKDROP_LAYER);
    expect(cutoutLook(look).hidden.filter((n) => n === BACKDROP_LAYER)).toHaveLength(1);
    expect(cutoutLook(cutoutLook(look))).toEqual(cutoutLook(look));
  });

  it("runs its own rAF loop with the gap between frames as dt, the first at 0", () => {
    const { factory, renderer } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.start();
    player.start(); // idempotent
    expect(frames.size).toBe(1);
    tick(1000);
    tick(1016);
    tick(1048);
    expect(renderer.draws).toHaveLength(3);
    expect(seen.inputs.map((i) => i.dt)).toEqual([0, expect.closeTo(0.016, 9), expect.closeTo(0.032, 9)]);
    player.stop();
    expect(frames.size).toBe(0);
    player.start();
    tick(9000);
    expect(seen.inputs.at(-1)?.dt).toBe(0);
  });

  it("starts a mood crossfade on setEmotion (instant under reduced motion)", () => {
    const { factory } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets, reducedMotion: false }, factory);
    player.renderFrame(0.05);
    player.setEmotion("furious");
    player.renderFrame(0.05);
    expect(seen.drives.at(-1)?.mood).toEqual({ from: look.emotion, mix: 0 });
    player.renderFrame(0.1); // the driver clamps a step at 0.1 s
    expect(seen.drives.at(-1)?.mood?.mix).toBeCloseTo(0.1 / MOOD_FADE_S, 9);
    player.renderFrame(0.1);
    player.renderFrame(0.1);
    expect(seen.drives.at(-1)?.mood).toBeUndefined();

    const still = runPlayer(canvasIn(), { rig, look, assets, reducedMotion: true }, fakeRenderer().factory);
    still.renderFrame(0.05);
    still.setLook({ ...look, emotion: "grim" });
    still.renderFrame(0.05);
    expect(seen.drives.at(-1)?.mood).toBeUndefined();
  });

  it("fires a gesture once, on the next frame", () => {
    const { factory } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.renderFrame(0.05);
    player.gesture("nod");
    for (let i = 0; i < 4; i += 1) player.renderFrame(GESTURE_DURATION_S);
    expect(seen.inputs.map((i) => i.gesture)).toEqual([undefined, "nod", undefined, undefined, undefined]);
    expect(seen.drives[1]?.gesture?.name).toBe("nod");
  });

  it("lets setLevel win over the audio tap until it is cleared", () => {
    const analyser = { fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.27) };
    const context = { createAnalyser: () => analyser };
    const node = { context, connect: vi.fn(), disconnect: vi.fn() } as object as AudioNode;
    const player = runPlayer(canvasIn(), { rig, look, assets }, fakeRenderer().factory);
    player.renderFrame(0.02);
    player.attachAudio(node);
    player.renderFrame(0.02);
    player.setLevel(0.3);
    player.renderFrame(0.02);
    player.setLevel(7);
    player.renderFrame(0.02);
    player.setLevel(undefined);
    player.renderFrame(0.02);
    player.attachAudio(undefined);
    player.renderFrame(0.02);
    expect(seen.inputs.map((i) => i.level)).toEqual([0, expect.closeTo(1, 9), 0.3, 1, expect.closeTo(1, 9), 0]);
    expect(node.disconnect).toHaveBeenCalledWith(analyser);
  });

  it.each<[string, boolean | "auto" | undefined, () => void, boolean]>([
    ["auto, media query", undefined, () => (reduceQuery = true), true],
    ["auto, shell data-motion", "auto", () => document.documentElement.setAttribute("data-motion", "reduced"), true],
    ["forced off", false, () => (reduceQuery = true), false],
    ["forced on", true, () => undefined, true],
  ])("honours reduced motion: %s", (_label, reducedMotion, arrange, expected) => {
    arrange();
    const options = reducedMotion === undefined ? { rig, look, assets } : { rig, look, assets, reducedMotion };
    const { factory, renderer } = fakeRenderer();
    runPlayer(canvasIn(), options, factory).renderFrame(0.05);
    expect(seen.inputs[0]?.reducedMotion).toBe(expected);
    expect(renderer.draws[0]?.clock?.reducedMotion).toBe(expected);
  });

  it("sizes the canvas to its parent unless autoSize is false", () => {
    const sized = fakeRenderer();
    runPlayer(canvasIn(320, 180), { rig, look, assets }, sized.factory);
    expect(sized.renderer.resizes[0]).toEqual([320, 180, window.devicePixelRatio || 1]);
    const manual = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets, autoSize: false }, manual.factory);
    expect(manual.renderer.resizes).toEqual([]);
    player.resize(64, 32, 2);
    expect(manual.renderer.resizes).toEqual([[64, 32, 2]]);
  });

  it("dispose stops the loop, detaches the audio, disposes the renderer, and makes every call a no-op", () => {
    const analyser = { fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(0) };
    const node = { context: { createAnalyser: () => analyser }, connect: vi.fn(), disconnect: vi.fn() } as object as AudioNode;
    const { factory, renderer } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.attachAudio(node);
    player.start();
    tick(0);
    player.dispose();
    player.dispose();
    expect(cancelled).toHaveLength(1);
    expect(frames.size).toBe(0);
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(renderer.disposed).toBe(1);
    player.start();
    player.renderFrame(0.1);
    tick(16);
    expect(renderer.draws).toHaveLength(1);
  });

  it("draws through the real renderer (WebGL2 stub)", () => {
    const gl = createGlStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((id: string) => (id === "webgl2" ? gl.gl : null)) as HTMLCanvasElement["getContext"]);
    const player = createAvatarPlayer(canvasIn(), { rig, look, assets });
    gl.reset();
    player.renderFrame(1 / 30);
    // Every layer but the hidden backdrop, plus the glow passes.
    expect(gl.count("drawArrays")).toBe(rig.layers.length - 1 + 4);
    player.dispose();
  });
});
