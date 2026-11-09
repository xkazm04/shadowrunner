// @vitest-environment happy-dom
// The flicker (perfection-pass task 11): a flame with `data-flicker` layers (the cellar) flickers
// as a compositor animation of their scale and opacity and is never written `--flicker`; any other
// flame (the projection) gets `--flicker` from a loop that stops while the document is hidden and
// resumes on the clock when shown. requestAnimationFrame is driven by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flickerAt, flickerKeyframes, LAYER_VALUE, LOOP_MS, PEAK_FLICKER, REST_FLICKER, startFlicker } from "./flicker";

let queue: FrameRequestCallback[] = [];
let hidden = false;

function frame(t: number): void {
  const due = queue;
  queue = [];
  for (const cb of due) cb(t);
}

beforeEach(() => {
  queue = [];
  hidden = false;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "hidden");
});

describe("startFlicker", () => {
  it("stops while hidden and resumes on the clock when shown", () => {
    const root = document.createElement("div");
    root.setAttribute("data-flame", "");
    const stop = startFlicker(root);
    frame(1000);
    expect(root.style.getPropertyValue("--flicker")).toBe(flickerAt(1, 0.4).toFixed(3));
    expect(queue).toHaveLength(1);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    frame(1100);
    expect(queue).toHaveLength(0);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queue).toHaveLength(1);
    frame(9000);
    expect(root.style.getPropertyValue("--flicker")).toBe(flickerAt(9, 0.4).toFixed(3));

    stop();
    expect(root.style.getPropertyValue("--flicker")).toBe("");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queue).toHaveLength(1); // the frame asked before stop() was cancelled, no new one
  });

  it("animates the cellar's light layers on the compositor and never writes --flicker on them", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-flame><div data-flicker="scale"></div><div data-flicker="opacity"></div></div><div data-flame></div>';
    const calls: { kind: string | undefined; frames: Keyframe[]; options: unknown }[] = [];
    const cancel = vi.fn();
    vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (this: HTMLElement, frames, options) {
      calls.push({ kind: this.dataset.flicker, frames: frames as Keyframe[], options });
      const handle: Partial<Animation> = { cancel, finished: new Promise<Animation>(() => undefined) };
      return handle as Animation;
    });
    const stop = startFlicker(root);
    expect(calls.map((c) => c.kind)).toEqual(["scale", "opacity"]);
    expect(calls[0]?.options).toEqual({ duration: LOOP_MS, iterations: Infinity });
    expect(calls[0]?.frames).toEqual(flickerKeyframes("scale", 0.4));
    frame(1000);
    const [cellar, projection] = [...root.querySelectorAll<HTMLElement>("[data-flame]")];
    expect(cellar?.style.getPropertyValue("--flicker")).toBe("");
    expect(projection?.style.getPropertyValue("--flicker")).toBe(flickerAt(1, 2.5).toFixed(3));
    stop();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});

describe("flickerKeyframes", () => {
  it("is the curve through the layer's value, one loop from offset 0 to 1, seamless", () => {
    for (const kind of ["scale", "opacity"] as const) {
      const frames = flickerKeyframes(kind, 0.4);
      expect(frames[0]?.offset).toBe(0);
      expect(frames.at(-1)?.offset).toBe(1);
      expect(frames.at(-1)?.[kind]).toBe(frames[0]?.[kind]);
      expect(Number(frames[30]?.[kind])).toBeCloseTo(LAYER_VALUE[kind](flickerAt(0.99, 0.4)), 4);
    }
  });

  it("rests where the CSS paints the layers: scale 1 at the resting flicker, opacity 1 at the peak", () => {
    expect(LAYER_VALUE.scale(REST_FLICKER)).toBe(1);
    expect(LAYER_VALUE.opacity(PEAK_FLICKER)).toBe(1);
  });
});
