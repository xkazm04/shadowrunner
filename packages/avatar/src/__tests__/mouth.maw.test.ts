// The maw warp (cast-face-pass, `lips.maw`): an already-open painted mouth. Rest is the identity,
// the pose's opening widens the gap (the upper row lifts, the lower drops, rigidly), the teeth rows
// never cross, nothing at or past the window's edge moves, the corners bend MAW_BEND of the lips',
// the opening stretches the art's own seam row (no drawn interior), and press never squeezes the
// rows. Pixel art (`mouth.cell`): `sampleAt` moves every point of a shown cell by one displacement
// in whole cells (the art's own pixels move whole), and the interior covers whole cells.
import type { RigMouth } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyBias, EMOTION_BIAS } from "../mouth/emotion.js";
import { blendParams, restWeights, SHAPE_PARAMS, type MouthParams } from "../mouth/shapes.js";
import { MAW_BEND, MAW_LOWER_OF_HEIGHT, MAW_OPEN_OF_HEIGHT, MAW_TAP_REACH, MAW_TAPS, mawTaps, sampleAt, unwarp, warpBox, warpParams, warpPoint, type WarpField } from "../mouth/warp.js";

/** A carved grin: wide (span 240), teeth rows 60 tall around a gap along y 600. */
const GRIN: RigMouth = { cx: 500, lineY: 596, width: 220, lips: { left: 380, right: 620, upper: 570, lower: 630, seam: 600, maw: true } };
const LIPS: RigMouth = { ...GRIN, lips: { left: 380, right: 620, upper: 570, lower: 630, seam: 600 } };
/** The Redactor's measured mouth (pixel art, cell 7.1). */
const PIXEL: RigMouth = { cx: 515.5, lineY: 547, width: 89.25, cell: 7.1, lips: { left: 459, right: 570, upper: 545, lower: 560, seam: 550 } };
const one = (shape: keyof typeof SHAPE_PARAMS): MouthParams => blendParams({ ...restWeights(), rest: 0, [shape]: 1 });

function field(p: MouthParams, gap = 0, mouth: RigMouth = GRIN): WarpField {
  const f = warpParams(p, mouth, gap);
  if (f === undefined) throw new Error("identity");
  return f;
}

describe("maw warpParams", () => {
  it("rest with the jaw shut is the identity", () => {
    expect(warpParams(SHAPE_PARAMS.rest, GRIN, 0)).toBeUndefined();
  });

  it("open widens the gap: the upper row lifts, the lower drops, and wider open widens it more", () => {
    const mid = field(one("openMid"));
    const wide = field(one("openWide"));
    expect(mid.maw).toBe(true);
    expect(mid.lift).toBeGreaterThan(1);
    expect(mid.open).toBeGreaterThan(1);
    expect(wide.lift + wide.open).toBeGreaterThan(mid.lift + mid.open);
    // The upper row's lowest point (just above the seam) and the lower row's top move apart rigidly.
    const [, up] = warpPoint(wide, 500, 599.9, false);
    const [, down] = warpPoint(wide, 500, 600.1, false);
    expect(down - up).toBeCloseTo(0.2 + wide.lift + wide.open, 3);
    // A row's teeth keep their height at the centre (no squeeze): top and bottom of the upper row move alike.
    expect(warpPoint(wide, 500, 585, false)[1] - warpPoint(wide, 500, 595, false)[1]).toBeCloseTo(-10, 6);
  });

  it("the opening is sized from the teeth rows' height, not only the span", () => {
    const wide = field(one("openWide"), 80);
    const height = 630 - 570;
    expect(wide.lift + (wide.open - 0)).toBeLessThanOrEqual(MAW_OPEN_OF_HEIGHT * height + MAW_LOWER_OF_HEIGHT * height);
    expect(wide.open).toBeLessThanOrEqual(MAW_LOWER_OF_HEIGHT * height + 1e-9);
    // The same pose on lips of the same box opens much wider (a quarter of the span).
    const lips = field(one("openWide"), 80, LIPS);
    expect(lips.open).toBeGreaterThan(wide.open);
    expect(lips.maw).toBe(false);
  });

  it("the jaw layer is the lower row whole: its rows above the seam (a curved rim) drop with it", () => {
    const gap = 12;
    const f = field(one("openWide"), gap);
    // A jaw row 20 px above the seam near the centre: shown (pose adds gap) at y + open x profile.
    const [, rim] = warpPoint(f, 500, 580, true);
    expect(rim + gap).toBeCloseTo(580 + f.open, 6);
    // On lips the same row is the upper lip: it lifts.
    const lips = field(one("openWide"), gap, LIPS);
    expect(warpPoint(lips, 500, 580, true)[1] + gap).toBeLessThan(580);
    // The jaw's inverse needs no seam clamp: it inverts the forward map across the seam.
    for (const y of [575, 600, 625]) {
      const [sx, sy] = warpPoint(f, 470, y, true);
      const back = unwarp(f, warpBox(f, [380, 560, 240, 120]), true, sx, sy, 0);
      expect(back.y).toBeCloseTo(y, 3);
    }
  });

  it("corners bend MAW_BEND of the lips'; press never squeezes the rows", () => {
    const joy = applyBias(SHAPE_PARAMS.rest, EMOTION_BIAS.joy);
    const maw = field(joy);
    const lips = field(joy, 0, LIPS);
    expect(maw.dyL).toBeCloseTo(MAW_BEND * lips.dyL, 9);
    expect(maw.dxR).toBeCloseTo(MAW_BEND * lips.dxR, 9);
    const pressed = field({ ...one("closed") }, 6);
    expect(pressed.squeeze).toBe(0);
    expect(field(one("closed"), 6, LIPS).squeeze).toBeGreaterThan(0);
  });

  it("draws no interior: the opening is the art's own gap, searched about the seam inside the rows", () => {
    const f = field(one("openWide"), 10);
    const box = warpBox(f);
    for (const y of [600 - f.lift + 1, 600, 600 + f.open - 1]) {
      const u = unwarp(f, box, false, 500, y);
      expect(u.inner).toBe(0);
      expect(u.gap).toBeCloseTo(1, 6);
      expect(u.y).toBeCloseTo(600, 6);
    }
    // Outside the opening the art is drawn as warped.
    expect(unwarp(f, box, false, 500, 600 - f.lift - 5).gap).toBe(0);
    // The search: MAW_TAPS rows, symmetric about the seam, within half the thinner row.
    expect(f.reach).toBeCloseTo(MAW_TAP_REACH * 30, 9);
    const taps = mawTaps(f, 600);
    expect(taps).toHaveLength(MAW_TAPS);
    expect(Math.min(...taps)).toBeCloseTo(585, 9);
    expect(Math.max(...taps)).toBeCloseTo(615, 9);
    const lips = field(one("openWide"), 10, LIPS);
    expect(lips.reach).toBe(0);
    expect(unwarp(lips, warpBox(lips), false, 500, 600).inner).toBeCloseTo(1, 6);
    expect(unwarp(lips, warpBox(lips), false, 500, 600).gap).toBe(0);
  });
});

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const sign = fc.double({ min: -1, max: 1, noNaN: true });
const paramsArb = fc.record({
  width: fc.double({ min: 0.3, max: 1.6, noNaN: true }),
  open: unit,
  round: unit,
  teeth: unit,
  tongue: unit,
  press: unit,
  jaw: unit,
  smile: sign,
  snarl: unit,
  skew: sign,
  tight: unit,
});

describe("maw field properties", () => {
  it("the teeth rows never cross, and the window's edge never moves", () => {
    fc.assert(
      fc.property(paramsArb, fc.double({ min: 0, max: 80, noNaN: true }), unit, unit, fc.boolean(), (p, gap, u, v, jaw) => {
        const f = warpParams(p, GRIN, gap);
        if (f === undefined) return;
        const x = f.cx - f.winL + u * (f.winL + f.winR);
        const dyUp = v * (f.seam - (f.upper - f.fu));
        const [, above] = warpPoint(f, x, f.seam - 1e-6 - dyUp, jaw);
        const [, below] = warpPoint(f, x, f.seam + 1e-6 + v * (f.lower + f.fd - f.seam), jaw);
        expect(below).toBeGreaterThanOrEqual(above - 1e-6);
        const box = warpBox(f);
        for (const [ex, ey] of [[box[0], f.seam], [box[2], f.seam], [x, box[1]], [x, box[3]]]) {
          const [wx, wy] = warpPoint(f, ex ?? 0, ey ?? 0, false);
          expect(wx).toBeCloseTo(ex ?? 0, 6);
          expect(wy).toBeCloseTo(ey ?? 0, 6);
        }
      }),
    );
  });
});

describe("pixel snap (sampleAt)", () => {
  const f = field(one("openWide"), 6, PIXEL);
  const box = warpBox(f);
  const cell = 7.1;

  it("every point of a shown cell moves by one displacement, in whole cells", () => {
    let moved = 0;
    for (let gx = 61; gx <= 82; gx += 1) {
      for (let gy = 74; gy <= 82; gy += 1) {
        const points = [0.1, 0.5, 0.9].flatMap((a) => [0.1, 0.5, 0.9].map((b): [number, number] => [(gx + a) * cell, (gy + b) * cell]));
        const moves = points.map(([x, y]) => {
          const s = sampleAt(f, box, false, x, y, cell);
          return { dx: s.x - x, dy: s.y - y, inner: s.inner };
        });
        const first = moves[0];
        if (first === undefined) throw new Error("none");
        for (const m of moves) {
          expect(m.dx).toBeCloseTo(first.dx, 9);
          expect(m.dy).toBeCloseTo(first.dy, 9);
          expect(m.inner).toBe(first.inner);
        }
        for (const k of [first.dx / cell, first.dy / cell]) expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
        if (first.dy !== 0) moved += 1;
        // The interior's edge is hard on the grid.
        expect([0, 1]).toContain(first.inner);
      }
    }
    expect(moved).toBeGreaterThan(10);
  });

  it("is the plain unwarp without a cell, and outside the field's box", () => {
    expect(sampleAt(f, box, false, 515.3, 551.2, undefined)).toEqual(unwarp(f, box, false, 515.3, 551.2));
    expect(sampleAt(f, box, false, 10.3, 20.2, cell)).toEqual({ x: 10.3, y: 20.2, inner: 0, s: 0, gap: 0 });
    // The smooth field moves this point by a fraction of a cell; the snapped sample does not.
    const smooth = unwarp(f, box, false, 515.5, 545);
    expect(Math.abs(smooth.y - 545) % cell).toBeGreaterThan(0.01);
  });
});
