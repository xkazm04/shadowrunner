// measureLips (art-mouth): the painted lips' corners and outer edges on synthetic art. A lip
// ellipse on skin is found within 2 px (red lips, ink-dark greyscale lips, split across a head and
// a jaw layer at the lip line), with the seam on a dark parting; flat skin and lips the skin's
// colour are undefined, not guessed.
import { describe, expect, it } from "vitest";
import { measureLips } from "./mouthLips.js";
import type { Rgba } from "./types.js";

type Rgb = readonly [number, number, number];
const SKIN: Rgb = [214, 176, 158];
const LIP: Rgb = [168, 84, 86];

/** A w x h image: `paint(x, y)` per pixel, plus a small deterministic texture (brush noise). */
function image(w: number, h: number, paint: (x: number, y: number) => Rgb | undefined): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = paint(x, y);
      if (rgb === undefined) continue;
      const noise = ((x * 7 + y * 13) % 5) - 2;
      const k = (y * w + x) * 4;
      data[k] = rgb[0] + noise;
      data[k + 1] = rgb[1] + noise;
      data[k + 2] = rgb[2] + noise;
      data[k + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Lips: an ellipse centred (cx, cy), rx x ry, with an optional darker parting row band at cy. */
const inLips = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean =>
  ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

function face(lip: Rgb, skin: Rgb = SKIN, parting?: Rgb): Rgba {
  return image(200, 200, (x, y) => {
    if (!inLips(x, y, 100, 100, 30, 12)) return skin;
    return parting !== undefined && Math.abs(y + 0.5 - 100) < 1.5 ? parting : lip;
  });
}

const MOUTH = { cx: 100, lineY: 100, width: 50 };
const PLATE = [0, 0, 200, 200] as const;

function near(lips: ReturnType<typeof measureLips>, want: { left: number; right: number; upper: number; lower: number }): void {
  expect(lips).toBeDefined();
  if (lips === undefined) return;
  expect(Math.abs(lips.left - want.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(lips.right - want.right)).toBeLessThanOrEqual(2);
  expect(Math.abs(lips.upper - want.upper)).toBeLessThanOrEqual(2);
  expect(Math.abs(lips.lower - want.lower)).toBeLessThanOrEqual(2);
}

const ELLIPSE = { left: 70, right: 130, upper: 88, lower: 112 };

describe("measureLips", () => {
  it("finds a red lip ellipse on skin within 2 px", () => {
    near(measureLips([{ bbox: PLATE, image: face(LIP) }], MOUTH), ELLIPSE);
  });

  it("finds it with a dark parting at the lip line (the parting joins, the lips' colour ends)", () => {
    near(measureLips([{ bbox: PLATE, image: face(LIP, SKIN, [60, 30, 32]) }], MOUTH), ELLIPSE);
  });

  it("measures the seam at the dark parting; uniform lips have no seam (omitted, never 0)", () => {
    const parted = measureLips([{ bbox: PLATE, image: face(LIP, SKIN, [60, 30, 32]) }], MOUTH);
    expect(Math.abs((parted?.seam ?? Number.NaN) - 99)).toBeLessThanOrEqual(2);
    const lower = measureLips([{ bbox: [0, 10, 200, 200], image: face(LIP, SKIN, [60, 30, 32]) }], { ...MOUTH, lineY: 104 });
    expect(Math.abs((lower?.seam ?? Number.NaN) - 109)).toBeLessThanOrEqual(2); // the jaw cut above the parting: the seam stays on the art
    const flat = measureLips([{ bbox: PLATE, image: face(LIP) }], MOUTH);
    expect(flat).toBeDefined();
    expect("seam" in (flat ?? {})).toBe(false);
  });

  it("finds greyscale ink-dark lips by luminance", () => {
    near(measureLips([{ bbox: PLATE, image: face([92, 92, 92], [168, 168, 168]) }], MOUTH), ELLIPSE);
  });

  it("composites a head and a jaw cut at the lip line the same as one plate", () => {
    const plate = face(LIP);
    const jaw = image(80, 40, (x, y) => {
      const k = ((100 + y) * 200 + (60 + x)) * 4;
      return [plate.data[k] ?? 0, plate.data[k + 1] ?? 0, plate.data[k + 2] ?? 0];
    });
    const head = image(200, 200, (x, y) => (y >= 100 && x >= 60 && x < 140 && y < 140 ? [0, 0, 0] : [plate.data[(y * 200 + x) * 4] ?? 0, plate.data[(y * 200 + x) * 4 + 1] ?? 0, plate.data[(y * 200 + x) * 4 + 2] ?? 0]));
    const split = measureLips([{ bbox: PLATE, image: head }, { bbox: [60, 100, 80, 40], image: jaw }], MOUTH);
    expect(split).toEqual(measureLips([{ bbox: PLATE, image: plate }], MOUTH));
  });

  it("is in canvas px wherever the face sits", () => {
    const lips = measureLips([{ bbox: [300, 50, 200, 200], image: face(LIP) }], { cx: 400, lineY: 150, width: 50 });
    near(lips, { left: 370, right: 430, upper: 138, lower: 162 });
  });

  it("is undefined on flat skin and on lips the skin's colour", () => {
    expect(measureLips([{ bbox: PLATE, image: face(SKIN) }], MOUTH)).toBeUndefined();
    expect(measureLips([{ bbox: PLATE, image: face([SKIN[0] + 2, SKIN[1] - 1, SKIN[2]]) }], MOUTH)).toBeUndefined();
  });

  it("is undefined on transparent art, a zero width, or lips far wider than the mouth", () => {
    expect(measureLips([{ bbox: PLATE, image: image(200, 200, () => undefined) }], MOUTH)).toBeUndefined();
    expect(measureLips([{ bbox: PLATE, image: face(LIP) }], { ...MOUTH, width: 0 })).toBeUndefined();
    expect(measureLips([{ bbox: PLATE, image: face(LIP) }], { ...MOUTH, width: 25 })).toBeUndefined();
  });
});
