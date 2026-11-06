// The art mouth's warp field (spark art-mouth, mouth/warp.ts): rest is the identity, a smile raises
// the corners, an open viseme parts the lips over the interior (at the seam, also when the seam is
// below the jaw cut), a press closes them (the jaw pinned back by its own drop), the corners never
// reach the window's edge, nothing outside the window moves, head and jaw meet without a tear, and
// `unwarp` inverts `warpPoint` (the shader runs `unwarp`). A mouth without lips is "still".
import type { RigMouth } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mouthLips, mouthMode } from "../mouth/anchor.js";
import { applyBias, EMOTION_BIAS } from "../mouth/emotion.js";
import { blendParams, restWeights, SHAPE_PARAMS, type MouthParams } from "../mouth/shapes.js";
import { interiorOf, unwarp, warpBox, warpParams, warpPoint, type WarpField } from "../mouth/warp.js";

/** Saint Cardia: the jaw cut is the lip line. */
const CARDIA: RigMouth = { cx: 514.5, lineY: 476, width: 72, lips: { left: 477, right: 551, upper: 460, lower: 494 } };
/** Moth Widow: the cut is the upper lip's top; the lips part lower, inside the jaw layer. */
const MOTH: RigMouth = { cx: 509.5, lineY: 598, width: 90, lips: { left: 463, right: 561, upper: 598, lower: 635, seam: 612 } };
const BARE: RigMouth = { cx: 509.5, lineY: 599, width: 90 };
const one = (shape: keyof typeof SHAPE_PARAMS): MouthParams => blendParams({ ...restWeights(), rest: 0, [shape]: 1 });

function field(p: MouthParams, gap = 0, mouth: RigMouth = CARDIA): WarpField {
  const f = warpParams(p, mouth, gap);
  if (f === undefined) throw new Error("identity");
  return f;
}

describe("mouthMode and lips", () => {
  it("warps only a mouth with usable lips; without them (or with bad ones) it is still", () => {
    expect(mouthMode(CARDIA)).toBe("warp");
    expect(mouthMode(MOTH)).toBe("warp");
    expect(mouthMode(BARE)).toBe("still");
    expect(mouthMode({ ...CARDIA, render: "drawn" })).toBe("drawn");
    expect(mouthMode({ ...CARDIA, render: "still" })).toBe("still");
    expect(mouthMode(undefined)).toBeUndefined();
    expect(mouthLips({ ...CARDIA, lips: { left: 600, right: 500, upper: 0, lower: 1 } })).toBeUndefined();
    expect(mouthLips({ ...MOTH, lips: { left: 463, right: 561, upper: 598, lower: 635, seam: 640 } })).toBeUndefined();
    expect(warpParams(one("openWide"), BARE, 5)).toBeUndefined();
  });
});

describe("warpParams", () => {
  it("rest with the jaw shut is the identity (no field: the art is drawn as it is)", () => {
    expect(warpParams(SHAPE_PARAMS.rest, CARDIA, 0)).toBeUndefined();
    expect(warpParams(SHAPE_PARAMS.rest, MOTH, 0)).toBeUndefined();
  });

  it("a smile raises both corners and leaves the lip centre where it was", () => {
    const f = field(applyBias(SHAPE_PARAMS.rest, EMOTION_BIAS.joy));
    expect(warpPoint(f, 477, 476, false)[1]).toBeLessThan(476 - 4);
    expect(warpPoint(f, 551, 476, false)[1]).toBeLessThan(476 - 4);
    expect(warpPoint(f, 514.5, 476, false)[1]).toBeCloseTo(476, 6);
    const gloom = field(applyBias(SHAPE_PARAMS.rest, EMOTION_BIAS.gloom));
    expect(warpPoint(gloom, 477, 476, false)[1]).toBeGreaterThan(476 + 4);
  });

  it("an aa-like open parts the lips: both layers show the interior between the lines", () => {
    const f = field(one("openWide"), 6);
    expect(f.lift).toBeGreaterThan(2);
    expect(f.open).toBeGreaterThan(6);
    const box = warpBox(f);
    expect(unwarp(f, box, false, 514.5, 476).inner).toBeCloseTo(1, 6);
    expect(unwarp(f, box, false, 514.5, 476 - f.lift - 2).inner).toBe(0);
    // Toward the corners the opening closes (it ends short of them).
    expect(unwarp(f, box, false, 480, 476).inner).toBe(0);
    // In the jaw's own frame (the pose adds gap) the same lines sit `gap` higher.
    const jawBox = warpBox(f, [471, 475, 88, 30]);
    expect(unwarp(f, jawBox, true, 514.5, 476 - f.gap).inner).toBeCloseTo(1, 6);
    expect(unwarp(f, jawBox, true, 514.5, 476 + f.open - f.gap + 2).inner).toBe(0);
  });

  it("parts at the seam when it lies below the jaw cut (the whole mouth in the jaw)", () => {
    const gap = 10;
    const f = field(one("openMid"), gap, MOTH);
    expect(f.seam).toBe(612);
    // The jaw's upper lip (rows between the cut and the seam) is pinned to the head and lifts.
    expect(warpPoint(f, 509.5, 605, true)[1] + gap).toBeCloseTo(605 - f.lift, 0);
    // The lower lip shown in the head's frame sits `open` below the seam.
    expect(warpPoint(f, 509.5, 612.001, true)[1] + gap).toBeCloseTo(612 + f.open, 2);
    expect(unwarp(f, warpBox(f, [432, 598, 155, 92]), true, 509.5, 612 - gap).inner).toBeCloseTo(1, 6);
    // The head right above the cut moves with the jaw's rows right below it: no tear at lineY.
    const [, head] = warpPoint(f, 520, 597.999, false);
    const [, jaw] = warpPoint(f, 520, 598, true);
    expect(jaw + gap).toBeCloseTo(head, 2);
  });

  it("a PP-like press closes the lips even with the jaw down: the jaw is pinned back by its drop", () => {
    const gap = 8;
    const f = field(one("closed"), gap);
    expect(f.lift).toBe(0);
    expect(f.open).toBe(0);
    expect(unwarp(f, warpBox(f), false, 514.5, 476).inner).toBe(0);
    expect(warpPoint(f, 514.5, 476, true)[1]).toBeCloseTo(476 - gap, 6);
    // Its chin, below the feather, still drops with the jaw.
    expect(warpPoint(f, 514.5, f.lower + f.fd + 1, true)[1]).toBeCloseTo(f.lower + f.fd + 1, 6);
  });

  it("the interior is dark, from the lip colour, never pure black", () => {
    const { near, deep } = interiorOf([150, 70, 80]);
    expect(Math.max(...deep)).toBeLessThan(Math.max(...near));
    expect(Math.min(...deep)).toBeGreaterThan(0);
    expect(Math.min(...interiorOf([0, 0, 0]).deep)).toBeGreaterThan(0);
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
const mouthArb = fc.constantFrom(CARDIA, MOTH);

describe("warp field properties", () => {
  it("the corners stay inside the window, and nothing outside it moves", () => {
    fc.assert(
      fc.property(paramsArb, fc.double({ min: 0, max: 40, noNaN: true }), mouthArb, (p, gap, mouth) => {
        const f = warpParams(p, mouth, gap);
        if (f === undefined) return;
        expect(f.cx - f.hwL + f.dxL).toBeGreaterThan(f.cx - f.winL + 0.3 * (f.winL - f.hwL));
        expect(f.cx + f.hwR + f.dxR).toBeLessThan(f.cx + f.winR - 0.3 * (f.winR - f.hwR));
        const box = warpBox(f);
        for (const [x, y] of [[box[0] - 1, f.seam], [box[2] + 1, f.seam], [f.cx, box[1] - 1], [f.cx, box[3] + 1]]) {
          const [wx, wy] = warpPoint(f, x ?? 0, y ?? 0, false);
          expect(wx).toBeCloseTo(x ?? 0, 6);
          expect(wy).toBeCloseTo(y ?? 0, 6);
        }
      }),
    );
  });

  it("unwarp inverts warpPoint on both layers, above and below the seam", () => {
    fc.assert(
      fc.property(paramsArb, fc.double({ min: 0, max: 30, noNaN: true }), unit, unit, fc.boolean(), mouthArb, (p, gap, u, v, jaw, mouth) => {
        const f = warpParams(p, mouth, gap);
        if (f === undefined) return;
        const x = f.cx - f.winL + u * (f.winL + f.winR);
        const box = warpBox(f, jaw ? [f.cx - f.winL - 5, f.upper, f.winL + f.winR + 10, 200] : undefined);
        const up = f.upper - f.fu + v * (f.seam - 1 - (f.upper - f.fu));
        const [ax, ay] = warpPoint(f, x, up, jaw);
        const a = unwarp(f, box, jaw, ax, ay, 0);
        expect(Math.hypot(a.x - x, a.y - up)).toBeLessThan(0.5);
        const down = f.seam + 1 + v * (f.lower + f.fd - f.seam - 1);
        const [bx, by] = warpPoint(f, x, down, jaw);
        const b = unwarp(f, box, jaw, bx, by, 0);
        expect(Math.hypot(b.x - x, b.y - down)).toBeLessThan(0.5);
      }),
    );
  });
});
