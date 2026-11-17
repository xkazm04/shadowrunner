// @vitest-environment happy-dom
// The player's full input set (spec avatar-reach, design "Player core": one host loop): act, dim,
// lookAt, a clip's mouth track and a live rig swap reach the frame body through the player itself,
// as AvatarCanvas's props did, and the loop watches the canvas's host, not the canvas a context
// loss replaces. A fake renderer through runPlayer's factory seam; spies on advanceFrame's inputs
// and the Drive handed to poseLayers.
import * as rigModule from "@sr/rig";
import { ACT_S_MAX, defaultLook, type Drive, type Look, type Rig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mixSpans } from "../mouth/track.js";
import type { FrameInputs } from "../react/loop.js";
import { runPlayer, type RendererFactory } from "../player/run.js";
import type { FrameClock, Renderer, RigAssets } from "../render/types.js";
import type { MouthTrack } from "../speech/analyse.js";
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
const drawnRig: Rig = { ...rig, mouth: { cx: 512, lineY: 600, width: 120, render: "drawn" } };
/** Open wide all through a 1 s clip. */
const openWide: MouthTrack = { durationS: 1, at: (t) => mixSpans([{ shape: "openWide", startMs: 0, endMs: 1000 }], t * 1000) };

interface Fake {
  factory: RendererFactory;
  draws: { clock: FrameClock | undefined }[];
  setRigs: { rig: Rig; assets: RigAssets; beforeDraw: number }[];
}

function fakeRenderer(onCreate?: (canvas: HTMLCanvasElement) => void): Fake {
  const draws: Fake["draws"] = [];
  const setRigs: Fake["setRigs"] = [];
  const renderer: Renderer = {
    setRig: (r, a) => void setRigs.push({ rig: r, assets: a, beforeDraw: draws.length }),
    setLook: () => undefined,
    draw: (_poses, _look, clock) => void draws.push({ clock }),
    resize: () => undefined,
    info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
    dispose: () => undefined,
  };
  return {
    factory: (canvas) => {
      if (canvas instanceof HTMLCanvasElement) onCreate?.(canvas);
      return renderer;
    },
    draws,
    setRigs,
  };
}

function canvasIn(): HTMLCanvasElement {
  const host = document.createElement("div");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ width: 300, height: 200 } as DOMRect);
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

let frames: Map<number, FrameRequestCallback>;
let nextId: number;

function tick(now: number): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

beforeEach(() => {
  seen.inputs.length = 0;
  seen.drives.length = 0;
  frames = new Map();
  nextId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => void frames.delete(id));
  vi.spyOn(window, "matchMedia").mockImplementation(() => {
    const list = new window.EventTarget() as MediaQueryList;
    Object.defineProperty(list, "matches", { get: () => false });
    return list;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("the player's frame inputs", () => {
  it("act: the next frame's Drive carries the act, gone once ACT_S_MAX has passed", () => {
    const { factory } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets, reducedMotion: false }, factory);
    player.act("jaw");
    player.renderFrame(1 / 60);
    expect(seen.drives.at(-1)?.act?.layer).toBe("jaw");
    // The driver clamps a step to MAX_STEP_S, so ACT_S_MAX + 0.1 s passes as steps of 0.1 s.
    for (let s = 0; s < ACT_S_MAX + 0.1; s += 0.1) player.renderFrame(0.1);
    expect(seen.drives.at(-1)).not.toHaveProperty("act");
    player.dispose();
  });

  it("setDim: the clock carries the dim (instant under reduced motion); 0 drops the key", () => {
    const { factory, draws } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets, reducedMotion: true }, factory);
    player.setDim(1);
    player.renderFrame(1 / 60);
    expect(draws.at(-1)?.clock?.dim).toBe(1);
    player.setDim(0);
    player.renderFrame(1 / 60);
    expect(draws.at(-1)?.clock).not.toHaveProperty("dim");
    player.dispose();
  });

  it("setLookAt: the driver's inputs carry the point (a ref is read per frame); undefined drops it", () => {
    const { factory } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.setLookAt({ x: 1, y: 0 });
    player.renderFrame(1 / 60);
    expect(seen.inputs.at(-1)?.lookAt).toEqual({ x: 1, y: 0 });
    const ref: { current: { x: number; y: number } | null } = { current: { x: -1, y: 0.5 } };
    player.setLookAt(ref);
    player.renderFrame(1 / 60);
    expect(seen.inputs.at(-1)?.lookAt).toEqual({ x: -1, y: 0.5 });
    ref.current = null;
    player.renderFrame(1 / 60);
    expect(seen.inputs.at(-1)).not.toHaveProperty("lookAt");
    player.setLookAt(undefined);
    player.renderFrame(1 / 60);
    expect(seen.inputs.at(-1)).not.toHaveProperty("lookAt");
    player.dispose();
  });

  it("setClipMouth: a drawn mouth follows the clip's track with no loop of the caller's; undefined returns to the level", () => {
    const { factory, draws } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig: drawnRig, look, assets, reducedMotion: false }, factory);
    player.renderFrame(1 / 60);
    expect(draws.at(-1)?.clock?.mouth).toBeUndefined();
    player.setClipMouth({ track: openWide, clock: () => 0.2 });
    player.renderFrame(1 / 60);
    expect(draws.at(-1)?.clock?.mouth?.params.open ?? 0).toBeGreaterThan(0.9);
    player.setClipMouth(undefined);
    for (let k = 0; k < 60; k += 1) player.renderFrame(1 / 30);
    expect(draws.at(-1)?.clock?.mouth).toBeUndefined();
    player.dispose();
  });

  it("setRig: the renderer takes the new rig once, before the next draw; layerFrames name its layers", () => {
    const { factory, setRigs } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.renderFrame(1 / 60);
    const rig2: Rig = { ...rig, layers: rig.layers.slice(0, 3) };
    const assets2 = fakeAssets(rig2);
    player.setRig(rig2, assets2);
    player.renderFrame(1 / 60);
    expect(setRigs).toEqual([{ rig: rig2, assets: assets2, beforeDraw: 1 }]);
    const names = new Set(rig2.layers.map((l) => l.name));
    const drawn = (player.layerFrames?.() ?? []).map((f) => f.layer.name);
    expect(drawn.length).toBeGreaterThan(0);
    for (const name of drawn) expect(names.has(name)).toBe(true);
    player.dispose();
  });
});

describe("the player's loop after a context loss", () => {
  /** An IntersectionObserver that reports a detached node as out of view, as a browser does. */
  class DetachedBlindObserver {
    static all: DetachedBlindObserver[] = [];
    readonly targets: Element[] = [];
    readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      DetachedBlindObserver.all.push(this);
    }
    observe(target: Element): void {
      this.targets.push(target);
    }
    disconnect(): void {
      this.targets.length = 0;
    }
    report(): void {
      const entries = this.targets.map((target) => ({ target, isIntersecting: target.isConnected }) as IntersectionObserverEntry);
      this.callback(entries, this as object as IntersectionObserver);
    }
  }

  it("keeps scheduling frames when the renderer swaps the canvas: it watches the host element", () => {
    DetachedBlindObserver.all = [];
    vi.stubGlobal("IntersectionObserver", DetachedBlindObserver);
    Object.defineProperty(window, "IntersectionObserver", { value: DetachedBlindObserver, configurable: true, writable: true });
    const created: HTMLCanvasElement[] = [];
    const { factory, draws } = fakeRenderer((canvas) => void created.push(canvas));
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.start();
    tick(0);
    // The GL renderer's context-loss path (gl/renderer.ts): `lost.replaceWith(fresh)`.
    for (const lost of created) lost.replaceWith(lost.ownerDocument.createElement("canvas"));
    expect(created).toHaveLength(1);
    for (const observer of DetachedBlindObserver.all) observer.report();
    expect(frames.size).toBe(1);
    tick(16);
    expect(draws).toHaveLength(2);
    player.dispose();
  });
});
