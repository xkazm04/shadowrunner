// @vitest-environment happy-dom
// <AvatarCanvas> (task 5, req 6, 5.3) with React Testing Library, the counting GL stub behind
// HTMLCanvasElement.getContext, and a hand-driven requestAnimationFrame.
import { cleanup, render } from "@testing-library/react";
import { defaultLook, poseLayers, type Drive, type Gesture, type Look } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glowGain } from "../gl/glow.js";
import { fitView, hexToRgb, layerAffine, lookLight } from "../render/frame.js";
import { AvatarCanvas, type AvatarCanvasProps } from "../react/AvatarCanvas.js";
import { createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const rig = malakorRig();
const assets = fakeAssets(rig);
const look: Look = defaultLook(rig);

let gl: GlStub;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let cancelled: number[];
let reduceQuery: boolean;

/** Runs the pending animation frame(s) at `now` ms. */
function tick(now: number): void {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(now);
}

beforeEach(() => {
  gl = createGlStub();
  frames = new Map();
  nextId = 1;
  cancelled = [];
  reduceQuery = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((id: string) => (id === "webgl2" ? gl.gl : null)) as HTMLCanvasElement["getContext"]);
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
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-motion");
});

const mount = (over: Partial<AvatarCanvasProps> = {}) => render(<AvatarCanvas rig={rig} look={look} assets={assets} {...over} />);

/** Uniform values of the last frame, per uniform name, in call order. */
function uniforms(method: string, name: string): unknown[][] {
  return gl.log.filter(([n, a]) => n === method && (a[0] as { uniform?: string } | null)?.uniform === name).map(([, a]) => a.slice(1));
}

const glow = hexToRgb(look.palette.glow);
const tintAt = (t: number, reducedMotion: boolean) => glow.map((c) => expect.closeTo(c * glowGain({ t, reducedMotion }), 6));

describe("<AvatarCanvas>", () => {
  it("owns a canvas and a WebGL2 renderer, and draws layers + 4 every frame", () => {
    const { container } = mount({ className: "face" });
    const host = container.querySelector("div.face");
    expect(host?.querySelectorAll("canvas")).toHaveLength(1);
    expect(gl.count("texImage2D")).toBe(rig.layers.length);
    for (let i = 0; i < 5; i += 1) {
      gl.reset();
      tick(i * 16);
      expect(gl.count("drawArrays")).toBe(rig.layers.length + 4);
      expect(gl.count("texImage2D")).toBe(0);
    }
  });

  it("times frames on the driver's clock: each frame gap is clamped, so the glow pulse follows driver t", () => {
    mount();
    tick(1000);
    tick(1016);
    gl.reset();
    tick(61016); // a minute asleep: the driver advances at most MAX_STEP_S (0.1 s)
    expect(uniforms("uniform3f", "u_tint")[0]).toEqual(tintAt(0.116, false));
  });

  it("lets a drive prop override the driver: every layer is placed from that Drive", () => {
    const open: Drive = { t: 0, headYaw: 12, headPitch: -4, jawOpen: 1, blink: 1 };
    const { container } = mount({ drive: open });
    gl.reset();
    tick(0);
    const canvas = container.querySelector("canvas");
    const view = fitView(rig, canvas?.width ?? 0, canvas?.height ?? 0);
    const expected = poseLayers(rig, look, open).map((pose) => {
      const layer = rig.layers.find((l) => l.name === pose.name);
      if (layer === undefined) throw new Error(pose.name);
      const m = layerAffine(layer, pose, view, lookLight(rig, look).browY);
      // u_m is a Float32Array (perfection-pass P1): GL holds float32 either way.
      return [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1].map((v) => Math.fround(v));
    });
    expect(uniforms("uniformMatrix3fv", "u_m").map((args) => args[1])).toEqual(expected);
  });

  it.each([
    ["prefers-reduced-motion", () => (reduceQuery = true)],
    ["the shell's data-motion", () => document.documentElement.setAttribute("data-motion", "reduced")],
  ])("reads reduced motion from %s: the glow holds still", (_label, reduce) => {
    reduce();
    mount();
    const tints: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      gl.reset();
      tick(i * 50);
      tints.push(uniforms("uniform3f", "u_tint")[0]);
    }
    for (const t of tints) expect(t).toEqual(tintAt(0, true));
  });

  it.each([
    [false, (gain: number) => expect(gain).toBeLessThan(1.2)],
    [true, (gain: number) => expect(gain).toBeCloseTo(2, 9)],
  ])("starts a gesture on prop change (reduced motion %s: eased vs cut to its peak)", (reduced, check) => {
    reduceQuery = reduced;
    const { rerender } = mount();
    tick(0);
    tick(16);
    const flare: Gesture = "flare";
    rerender(<AvatarCanvas rig={rig} look={look} assets={assets} gesture={flare} />);
    gl.reset();
    tick(32);
    const crownIndex = poseLayers(rig, look, { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 }).findIndex((p) => p.name === "shard_c");
    const gain = (uniforms("uniform3f", "u_gain")[crownIndex] as number[])[0] ?? NaN;
    check(gain);
  });

  it("cancels its frame loop and disposes the renderer on unmount", () => {
    const { unmount, container } = mount();
    tick(0);
    const pending = [...frames.keys()];
    expect(pending).toHaveLength(1);
    unmount();
    expect(cancelled).toEqual(pending);
    expect(frames.size).toBe(0);
    expect([...gl.live]).toEqual([]);
    expect(container.querySelector("canvas")).toBeNull();
  });
});
