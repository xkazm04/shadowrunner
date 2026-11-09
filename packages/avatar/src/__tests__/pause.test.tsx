// @vitest-environment happy-dom
// Renderer runtime (perfection-pass P1, req 1.1, 1.2): AvatarCanvas and the player's own loop stop
// stepping and drawing while the page is hidden or the face is outside the viewport, resume with
// dt 0, keep `renderFrame` and `pauseOffscreen: false` running, and cap the buffer DPR at 2. A
// controllable IntersectionObserver and document.visibilityState stand in for the browser.
import { cleanup, render } from "@testing-library/react";
import { defaultLook, type Look } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPlayer, type RendererFactory } from "../player/run.js";
import { AvatarCanvas } from "../react/AvatarCanvas.js";
import { bufferDpr, MAX_DPR } from "../react/loop.js";
import type { FrameClock, Renderer } from "../render/types.js";
import { createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const rig = malakorRig();
const assets = fakeAssets(rig);
const look: Look = defaultLook(rig);

let gl: GlStub;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let observers: FakeObserver[];
let hidden: boolean;

/** A stand-in for a DOM type the test cannot construct; only the members the code uses exist. */
const stand = <T extends object>(value: object): T => value as T;

class FakeObserver {
  readonly targets: Element[] = [];
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  disconnect(): void {
    this.targets.length = 0;
  }
  /** Reports every observed target as in or out of view. */
  report(isIntersecting: boolean): void {
    const entries = this.targets.map((target) => stand<IntersectionObserverEntry>({ target, isIntersecting }));
    this.callback(entries, stand<IntersectionObserver>(this));
  }
}

function tick(now: number): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

const inView = (yes: boolean): void => observers.forEach((o) => o.report(yes));

function pageHidden(yes: boolean): void {
  hidden = yes;
  document.dispatchEvent(new window.Event("visibilitychange"));
}

beforeEach(() => {
  gl = createGlStub();
  frames = new Map();
  nextId = 1;
  observers = [];
  hidden = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((id: string) => (id === "webgl2" ? gl.gl : null)) as HTMLCanvasElement["getContext"]);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Object.defineProperty(window, "IntersectionObserver", { value: FakeObserver, configurable: true, writable: true });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => (hidden ? "hidden" : "visible"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("AvatarCanvas pauses offscreen", () => {
  it("stops scheduling frames out of view or on a hidden page, and resumes on return", () => {
    render(<AvatarCanvas rig={rig} look={look} assets={assets} />);
    tick(0);
    expect(frames.size).toBe(1);
    inView(false);
    expect(frames.size).toBe(0);
    gl.reset();
    tick(16);
    expect(gl.count("drawArrays")).toBe(0);
    inView(true);
    expect(frames.size).toBe(1);
    tick(5000);
    expect(gl.count("drawArrays")).toBeGreaterThan(0);
    pageHidden(true);
    expect(frames.size).toBe(0);
    pageHidden(false);
    expect(frames.size).toBe(1);
  });

  it("keeps running with pauseOffscreen false", () => {
    render(<AvatarCanvas rig={rig} look={look} assets={assets} pauseOffscreen={false} />);
    expect(observers).toHaveLength(0);
    pageHidden(true);
    tick(0);
    expect(frames.size).toBe(1);
  });

  it("runs as before where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    Object.defineProperty(window, "IntersectionObserver", { value: undefined, configurable: true, writable: true });
    render(<AvatarCanvas rig={rig} look={look} assets={assets} />);
    gl.reset();
    tick(0);
    expect(gl.count("drawArrays")).toBeGreaterThan(0);
    expect(frames.size).toBe(1);
  });

  it("sizes the drawing buffer at most at DPR 2", () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 50 } as DOMRect);
    const { container } = render(<AvatarCanvas rig={rig} look={look} assets={assets} />);
    const canvas = container.querySelector("canvas");
    expect([canvas?.width, canvas?.height]).toEqual([200, 100]);
  });
});

function fakeRenderer(): { factory: RendererFactory; draws: (FrameClock | undefined)[]; resizes: number[][] } {
  const draws: (FrameClock | undefined)[] = [];
  const resizes: number[][] = [];
  const renderer: Renderer = {
    setRig: () => undefined,
    setLook: () => undefined,
    draw: (_poses, _look, clock) => void draws.push(clock),
    resize: (w, h, dpr) => void resizes.push([w, h, dpr]),
    info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
    dispose: () => undefined,
  };
  return { factory: () => renderer, draws, resizes };
}

function canvasIn(): HTMLCanvasElement {
  const host = document.createElement("div");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ width: 300, height: 200 } as DOMRect);
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

describe("the player's loop pauses offscreen", () => {
  it("draws nothing while out of view and resumes with dt 0 (no time jump)", () => {
    const { factory, draws } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    player.start();
    tick(0);
    tick(50);
    const t = draws.at(-1)?.t ?? NaN;
    expect(t).toBeCloseTo(0.05, 9);
    inView(false);
    tick(100);
    expect(draws).toHaveLength(2);
    inView(true);
    tick(9000);
    expect(draws).toHaveLength(3);
    expect(draws.at(-1)?.t).toBeCloseTo(t, 9);
    tick(9016);
    expect(draws.at(-1)?.t).toBeCloseTo(t + 0.016, 9);
    player.dispose();
  });

  it("renderFrame steps and draws while paused; a stopped player stays stopped when it comes back into view", () => {
    const { factory, draws } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets }, factory);
    pageHidden(true);
    player.start();
    expect(frames.size).toBe(0);
    player.renderFrame(0.1);
    expect(draws).toHaveLength(1);
    player.stop();
    pageHidden(false);
    expect(frames.size).toBe(0);
    player.start();
    expect(frames.size).toBe(1);
    player.dispose();
    expect(observers.every((o) => o.targets.length === 0)).toBe(true);
  });

  it("pauseOffscreen false keeps the loop on a hidden page; autoSize caps the DPR", () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2.625);
    const { factory, draws, resizes } = fakeRenderer();
    const player = runPlayer(canvasIn(), { rig, look, assets, pauseOffscreen: false }, factory);
    expect(resizes).toEqual([[300, 200, MAX_DPR]]);
    pageHidden(true);
    player.start();
    tick(0);
    expect(draws).toHaveLength(1);
    player.dispose();
  });
});

describe("bufferDpr", () => {
  it("caps at MAX_DPR and falls back to 1", () => {
    expect([bufferDpr(1), bufferDpr(1.5), bufferDpr(2), bufferDpr(3), bufferDpr(undefined), bufferDpr(0), bufferDpr(Number.NaN)]).toEqual([1, 1.5, 2, 2, 1, 1, 1]);
  });
});
