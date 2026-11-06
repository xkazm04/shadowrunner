// face-control WP-B: eye anatomy on synthetic eyes. measureIris finds the iris within 2 px (white
// eyes with and without the iris-free edit, a mask edit, glowing slits, dark eyeballs), the socket
// mask covers the iris and stays inside the lids, the iris image and the iris-free eye are what they
// say, the closed art falls back to drawn lids over an empty dark socket, and an eye with no opening
// is left alone (undefined).
import { describe, expect, it } from "vitest";
import { cleanEye, closedArt, irisFreePrompt, irisImage } from "./eyeArt.js";
import { measureIris, openingBits, socketBits, type Iris } from "./eyes.js";
import type { Rgba } from "./types.js";

const W = 80;
const H = 50;
const SKIN: [number, number, number] = [196, 156, 136];
const WHITE: [number, number, number] = [236, 234, 228];
const IRIS: [number, number, number] = [60, 110, 170];
const PUPIL: [number, number, number] = [14, 14, 20];
const LID: [number, number, number] = [60, 40, 36];

/** The opening: an ellipse centred (40, 25), radii 30 x ry. */
const inOpening = (x: number, y: number, ry: number) => ((x + 0.5 - 40) / 30) ** 2 + ((y + 0.5 - 25) / ry) ** 2 <= 1;

interface Eye {
  iris: Iris;
  ry?: number;
  look?: "white" | "glow" | "dark";
}

/** A painted eye: skin, a lid line around the opening, whites, an iris with a pupil and a highlight (or a lit slit, or a dark eyeball). */
function paint({ iris, ry = 13, look = "white" }: Eye, withIris = true): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c: readonly number[] = SKIN;
      const open = inOpening(x, y, ry);
      if (!open && inOpening(x, y, ry + 2.5)) c = LID;
      if (open) {
        const d = Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy);
        if (look === "glow") c = withIris ? [235, 110, 10] : [235, 110, 10];
        else if (look === "dark") c = [36, 42, 44];
        else c = withIris && d <= iris.r ? (d <= iris.r * 0.35 ? PUPIL : IRIS) : WHITE;
        if (withIris && look === "white" && Math.hypot(x + 0.5 - iris.cx + 2, y + 0.5 - iris.cy + 2) <= 1.2) c = [250, 250, 250];
      }
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

const near = (got: Iris | undefined, want: Iris, tol = 2) => {
  expect(got).toBeDefined();
  if (got === undefined) return;
  expect(Math.abs(got.cx - want.cx), `cx ${got.cx} vs ${want.cx}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(got.cy - want.cy), `cy ${got.cy} vs ${want.cy}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(got.r - want.r), `r ${got.r} vs ${want.r}`).toBeLessThanOrEqual(tol);
};

const CASES: Iris[] = [
  { cx: 40, cy: 25, r: 9 },
  { cx: 31.5, cy: 24, r: 8 },
  { cx: 50, cy: 26.5, r: 10 },
];

describe("measureIris", () => {
  it.each(CASES)("white eye, no edit: within 2 px (%o)", (iris) => near(measureIris(paint({ iris })), iris));

  it.each(CASES)("white eye with the iris-free edit: within 2 px (%o)", (iris) => near(measureIris(paint({ iris }), { clean: paint({ iris }, false) }), iris));

  it("an iris cut by both lids keeps its width: within 2 px", () => {
    const iris = { cx: 40, cy: 25, r: 11 };
    near(measureIris(paint({ iris, ry: 8 })), iris);
  });

  it("a mask edit (opening green, iris magenta) gives the iris", () => {
    const iris = { cx: 36, cy: 25, r: 9 };
    const marks = paint({ iris });
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (!inOpening(x, y, 13)) continue;
      marks.data.set(Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy) <= iris.r ? [255, 0, 255] : [0, 255, 0], i * 4);
    }
    near(measureIris(paint({ iris }), { marks }), iris);
  });

  it("a glowing slit: the largest disc in the light (its half-height, at its middle)", () => {
    const got = measureIris(paint({ iris: { cx: 40, cy: 25, r: 0 }, ry: 7, look: "glow" }), { look: "glow", tint: [235, 110, 10] });
    near(got, { cx: 40, cy: 25, r: 7 }, 1.5);
  });

  it("a dark eyeball: the largest disc in the dark", () => {
    near(measureIris(paint({ iris: { cx: 40, cy: 25, r: 0 }, ry: 12, look: "dark" }), { look: "dark" }), { cx: 40, cy: 25, r: 12 }, 1.5);
  });

  it("an eye with no opening is unsure (undefined)", () => {
    const skin = paint({ iris: { cx: 40, cy: 25, r: 9 }, ry: 0.01 });
    expect(measureIris(skin)).toBeUndefined();
    expect(openingBits(skin)).toBeUndefined();
  });
});

describe("socketBits", () => {
  it("covers every visible iris pixel and stays inside the lids", () => {
    for (const iris of CASES) {
      const eye = paint({ iris });
      const found = measureIris(eye);
      if (found === undefined) throw new Error("no iris");
      const socket = socketBits(eye, found);
      if (socket === undefined) throw new Error("no socket");
      let outside = 0;
      let set = 0;
      for (let i = 0; i < W * H; i++) {
        const x = i % W;
        const y = Math.floor(i / W);
        if (inOpening(x, y, 13) && Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy) <= iris.r) expect(socket[i], `iris pixel ${x},${y}`).toBe(1);
        if (socket[i] === 1) {
          set += 1;
          outside += inOpening(x, y, 13) ? 0 : 1;
        }
      }
      expect(outside / set).toBeLessThan(0.05);
    }
  });

  it("a face whose lids close in has a smaller opening; shut lids give an empty one", () => {
    const iris = { cx: 40, cy: 25, r: 9 };
    const base = paint({ iris });
    const cues = { look: "white" as const, sclera: WHITE, irisAt: () => false };
    const half = socketBits(paint({ iris, ry: 6 }), iris, cues);
    const full = socketBits(base, iris, cues);
    expect(half !== undefined && full !== undefined && half.reduce((a, b) => a + b, 0) < 0.6 * full.reduce((a, b) => a + b, 0)).toBe(true);
    const shut = socketBits(paint({ iris, ry: 0.01 }), iris, cues);
    expect(shut?.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("eye art", () => {
  const iris = { cx: 40, cy: 25, r: 9 };
  const eye = paint({ iris });
  const socket = socketBits(eye, iris) ?? new Uint8Array(W * H);

  it("the iris image is the iris in a feathered disc centred on it", () => {
    const art = irisImage(eye, iris, socket);
    const [x0, y0, w, h] = art.box;
    expect(Math.abs(x0 + w / 2 - iris.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(y0 + h / 2 - iris.cy)).toBeLessThanOrEqual(1);
    const at = (x: number, y: number) => [...art.image.data.subarray(((y - y0) * w + x - x0) * 4, ((y - y0) * w + x - x0) * 4 + 4)];
    expect(at(46, 25)).toEqual([...IRIS, 255]);
    expect(at(x0, y0)[3]).toBe(0);
  });

  it("the iris-free eye shows no iris colour inside the socket; the lids are untouched", () => {
    const clean = cleanEye(eye, iris, socket, { look: "white" });
    for (let i = 0; i < W * H; i++) {
      const c = [...clean.data.subarray(i * 4, i * 4 + 3)];
      if (socket[i] === 1) expect(Math.hypot((c[0] ?? 0) - WHITE[0], (c[1] ?? 0) - WHITE[1], (c[2] ?? 0) - WHITE[2])).toBeLessThan(30);
      else expect(c).toEqual([...eye.data.subarray(i * 4, i * 4 + 3)]);
    }
  });

  it("the closed art is the plate when it is lid, drawn lids over an empty dark socket", () => {
    const lidPlate = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).map((_, i) => [...SKIN, 255][i % 4] ?? 0) };
    expect(closedArt(eye, lidPlate, socket).fromPlate).toBe(true);
    const hole = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 8)) };
    const drawn = closedArt(eye, hole, socket);
    expect(drawn.fromPlate).toBe(false);
    const mid = (25 * W + 40) * 4;
    expect(drawn.image.data[mid] ?? 0).toBeGreaterThan(30);
  });

  it("the iris-free prompt keeps the lids and names no gaze", () => {
    const prompt = irisFreePrompt("Saint Cardia", "Faceted gothic painting");
    expect(prompt).toContain("paint the white of the eye");
    expect(prompt).toContain("Keep the eyelids, lashes");
    expect(prompt).toMatch(/The art style is Faceted gothic painting\.$/);
  });
});
