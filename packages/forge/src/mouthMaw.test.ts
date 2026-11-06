// measureMaw (cast-face-pass) on synthetic grins: a clenched grin of teeth in an ink outline on skin
// (Lot Ninety's kind: wider than the jaw's mouth), an open maw of teeth rows over a wide dark gap in
// a dark void (the Announcer's kind), a grin whose corners curve up, and a grin split across a head
// and a jaw layer at the cut. Corners, teeth rows and seam within 2 px; a lip mouth and flat skin are
// undefined, not guessed.
import { describe, expect, it } from "vitest";
import { measureMaw } from "./mouthMaw.js";
import type { Rgba } from "./types.js";

type Rgb = readonly [number, number, number];
const SKIN: Rgb = [176, 170, 132];
const INK: Rgb = [24, 22, 20];
const TOOTH: Rgb = [236, 228, 200];
const GUM_LINE: Rgb = [120, 112, 92];

function image(w: number, h: number, paint: (x: number, y: number) => Rgb | undefined): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = paint(x, y);
      if (rgb === undefined) continue;
      const noise = ((x * 7 + y * 13) % 5) - 2;
      const k = (y * w + x) * 4;
      data.set([rgb[0] + noise, rgb[1] + noise, rgb[2] + noise, 255], k);
    }
  }
  return { width: w, height: h, data };
}

interface Grin {
  cx: number;
  seam: number;
  /** Half-width of the teeth; the ink reaches `ink` px further. */
  rx: number;
  ink: number;
  /** Teeth rows: px above and below the seam. */
  up: number;
  down: number;
  /** The gap's height (1 for clenched teeth). */
  gap: number;
  /** How far the corners curve up (px at the corner). */
  curve?: number;
  skin?: Rgb;
}

/** A grin: per column inside the corners, upper teeth, the gap (ink), lower teeth, in an ink outline; teeth separated every 12 px. */
function grin(g: Grin, w = 300, h = 220): Rgba {
  const { cx, seam, rx, ink, up, down, gap, curve = 0, skin = SKIN } = g;
  return image(w, h, (x, y) => {
    const t = (x + 0.5 - cx) / (rx + ink);
    if (Math.abs(t) > 1) return skin;
    const lift = curve * t * t;
    const shrink = Math.sqrt(Math.max(0, 1 - t * t));
    const s = seam - lift;
    const top = s - gap / 2 - up * shrink;
    const bottom = s + gap / 2 + down * shrink;
    if (y + 0.5 < top - 3 || y + 0.5 > bottom + 3) return skin;
    if (y + 0.5 < top || y + 0.5 > bottom || Math.abs(x + 0.5 - cx) > rx) return INK;
    if (Math.abs(y + 0.5 - s) <= gap / 2) return INK;
    if (Math.round(x - cx) % 12 === 0) return GUM_LINE;
    return TOOTH;
  });
}

const ART = (img: Rgba) => [{ bbox: [0, 0, img.width, img.height] as const, image: img }];

describe("measureMaw", () => {
  it("a clenched grin wider than the jaw's mouth: corners at the ink, teeth rows and the seam", () => {
    const g: Grin = { cx: 150, seam: 110, rx: 72, ink: 6, up: 30, down: 22, gap: 2 };
    // The jaw's measured mouth is narrower than the grin (Lot Ninety: 98 px vs a 160 px grin).
    const lips = measureMaw(ART(grin(g)), { cx: 150, lineY: 111, width: 98 });
    expect(lips).toBeDefined();
    if (lips === undefined) return;
    expect(lips.maw).toBe(true);
    expect(Math.abs(lips.left - (150 - 78))).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.right - (150 + 78))).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.upper - (110 - 1 - 30))).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.lower - (110 + 1 + 22))).toBeLessThanOrEqual(2);
    expect(Math.abs((lips.seam ?? 0) - 110)).toBeLessThanOrEqual(2);
  });

  it("an open maw over a wide dark gap in a dark void: the corners at its ink", () => {
    const void_: Rgb = [40, 30, 52];
    const g: Grin = { cx: 150, seam: 110, rx: 80, ink: 4, up: 18, down: 18, gap: 14, skin: void_ };
    const lips = measureMaw(ART(grin(g)), { cx: 150, lineY: 104, width: 120 });
    expect(lips).toBeDefined();
    if (lips === undefined) return;
    expect(Math.abs(lips.upper - (110 - 7 - 18))).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.lower - (110 + 7 + 18))).toBeLessThanOrEqual(2);
    expect(Math.abs((lips.seam ?? 0) - 110)).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.left - 66)).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.right - 234)).toBeLessThanOrEqual(2);
  });

  it("follows corners that curve up", () => {
    const g: Grin = { cx: 150, seam: 120, rx: 70, ink: 5, up: 26, down: 20, gap: 2, curve: 18 };
    const lips = measureMaw(ART(grin(g)), { cx: 150, lineY: 121, width: 100 });
    expect(lips).toBeDefined();
    if (lips === undefined) return;
    expect(Math.abs(lips.left - 75)).toBeLessThanOrEqual(2);
    expect(Math.abs(lips.right - 225)).toBeLessThanOrEqual(2);
    expect(Math.abs((lips.seam ?? 0) - 120)).toBeLessThanOrEqual(2);
  });

  it("reads a grin split across a head and a jaw layer at the cut", () => {
    const g: Grin = { cx: 150, seam: 110, rx: 72, ink: 6, up: 30, down: 22, gap: 2 };
    const whole = grin(g);
    const cut = 116;
    const head = { width: 300, height: cut, data: whole.data.slice(0, 300 * cut * 4) };
    const jaw = { width: 300, height: 220 - cut, data: whole.data.slice(300 * cut * 4) };
    const lips = measureMaw([{ bbox: [0, 0, 300, cut] as const, image: head }, { bbox: [0, cut, 300, 220 - cut] as const, image: jaw }], { cx: 150, lineY: cut, width: 98 });
    expect(lips).toBeDefined();
    expect(Math.abs((lips?.seam ?? 0) - 110)).toBeLessThanOrEqual(2);
    expect(Math.abs((lips?.lower ?? 0) - 133)).toBeLessThanOrEqual(2);
  });

  it("a closed lip mouth and flat skin are unsure", () => {
    const lipsOnly = image(300, 220, (x, y) => (((x + 0.5 - 150) / 40) ** 2 + ((y + 0.5 - 110) / 10) ** 2 <= 1 ? [150, 70, 72] : SKIN));
    expect(measureMaw(ART(lipsOnly), { cx: 150, lineY: 110, width: 80 })).toBeUndefined();
    expect(measureMaw(ART(image(300, 220, () => SKIN)), { cx: 150, lineY: 110, width: 80 })).toBeUndefined();
  });
});
