// measureMouth (llm-avatar-lab): the lip line, centre and width of a synthetic jaw strip.
import { describe, expect, it } from "vitest";
import { MOUTH_OF_HEAD, MOUTH_OF_JAW, measureMouth } from "./mouthAnchor.js";
import type { Rgba } from "./types.js";

/** A w x h jaw image whose column x is opaque from row `tops(x)` down (-1: empty column). */
function strip(w: number, h: number, tops: (x: number) => number, alpha = 255): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) {
    const t = tops(x);
    if (t < 0) continue;
    for (let y = t; y < h; y++) data[(y * w + x) * 4 + 3] = alpha;
  }
  return { width: w, height: h, data };
}

describe("measureMouth", () => {
  it("a flat strip: the lip line is its top edge, centred, 0.85 of its span", () => {
    const m = measureMouth({ bbox: [448, 493, 130, 22], image: strip(130, 22, () => 0) });
    expect(m).toEqual({ cx: 513, lineY: 493, width: 130 * MOUTH_OF_JAW });
  });

  it("uses only the opaque column span (transparent margins ignored)", () => {
    const m = measureMouth({ bbox: [100, 50, 60, 10], image: strip(60, 10, (x) => (x < 10 || x >= 50 ? -1 : 2)) });
    expect(m).toEqual({ cx: 100 + 10 + 20, lineY: 52, width: 40 * MOUTH_OF_JAW });
  });

  it("takes the median over the middle 60%: drooping corners and a single notch do not move it", () => {
    // 100 columns: corners (outer 20 each side) start at row 8, the middle at row 3, one notch at row 0.
    const m = measureMouth({ bbox: [0, 100, 100, 12], image: strip(100, 12, (x) => (x === 50 ? 0 : x < 20 || x >= 80 ? 8 : 3)) });
    expect(m?.lineY).toBe(103);
  });

  it("caps the width at the head's width times 0.32", () => {
    const m = measureMouth({ bbox: [0, 0, 200, 10], image: strip(200, 10, () => 0) }, { bbox: [0, 0, 300, 400] });
    expect(m?.width).toBeCloseTo(300 * MOUTH_OF_HEAD);
    const wide = measureMouth({ bbox: [0, 0, 100, 10], image: strip(100, 10, () => 0) }, { bbox: [0, 0, 1000, 400] });
    expect(wide?.width).toBeCloseTo(100 * MOUTH_OF_JAW);
  });

  it("reads a mask as well as an Rgba, and ignores faint alpha in an Rgba", () => {
    const data = new Uint8ClampedArray(20 * 5);
    for (let y = 1; y < 5; y++) for (let x = 0; x < 20; x++) data[y * 20 + x] = 255;
    expect(measureMouth({ bbox: [10, 10, 20, 5], image: { width: 20, height: 5, data } })).toEqual({ cx: 20, lineY: 11, width: 20 * MOUTH_OF_JAW });
    expect(measureMouth({ bbox: [0, 0, 20, 5], image: strip(20, 5, () => 0, 40) })).toBeUndefined();
  });

  it("undefined for an empty jaw", () => {
    expect(measureMouth({ bbox: [0, 0, 4, 4], image: strip(4, 4, () => -1) })).toBeUndefined();
  });
});
