// Eyes-only dim (stage LINE DEAD): `FrameClock.dim` / `<AvatarCanvas dim>`. Pure gain and easing
// with properties, then both renderers on Malakor against their stubs: no dim = the draw as
// before, full dim = emissive eyes untouched and every other layer darker (GL and canvas2D agree).
import { defaultLook, isEmissive, poseLayers, type Drive } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../gl/renderer.js";
import { clampDim, DIM_FLOOR, dimGain, easeDim } from "../render/frame.js";
import { createCanvasStub, createCtx2dStub, createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const DRIVE: Drive = { t: 1, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

describe("dimGain / easeDim (pure)", () => {
  it("keeps an emissive eye at 1 and takes every other layer toward DIM_FLOOR", () => {
    expect(dimGain({ kind: "eye" }, 1)).toBe(1);
    expect(dimGain({ kind: "eye", emissive: false }, 1)).toBeCloseTo(DIM_FLOOR, 12);
    expect(dimGain({ kind: "head" }, 1)).toBeCloseTo(DIM_FLOOR, 12);
    expect(dimGain({ kind: "head" }, 0)).toBe(1);
    expect(dimGain({ kind: "head" }, undefined)).toBe(1);
  });

  it("is bounded, monotone in dim and 1 for emissive eyes (property)", () => {
    const kinds = ["head", "eye", "jaw", "crown", "accessory"] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.option(fc.boolean(), { nil: undefined }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (kind, emissive, a, b) => {
          const layer = emissive === undefined ? { kind } : { kind, emissive };
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const g = dimGain(layer, hi);
          expect(g).toBeGreaterThanOrEqual(DIM_FLOOR);
          expect(g).toBeLessThanOrEqual(1);
          expect(dimGain(layer, lo)).toBeGreaterThanOrEqual(g);
          if (kind === "eye" && isEmissive(layer)) expect(g).toBe(1);
        },
      ),
    );
    expect(clampDim(Number.NaN)).toBe(0);
  });

  it("eases toward the target without overshoot, and jumps there under reduced motion", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (shown, target, dt) => {
          const next = easeDim(shown, target, dt, false);
          expect(Math.abs(next - target)).toBeLessThanOrEqual(Math.abs(shown - target) + 1e-12);
          expect(next >= Math.min(shown, target) - 1e-12 && next <= Math.max(shown, target) + 1e-12).toBe(true);
          expect(easeDim(shown, target, dt, true)).toBe(target);
        },
      ),
    );
    expect(easeDim(0, 1, 0, false)).toBe(0);
    expect(easeDim(0, 1, 100, false)).toBe(1);
  });
});

describe("dim in the renderers", () => {
  const rig = malakorRig();
  const look = defaultLook(rig);
  const poses = poseLayers(rig, look, DRIVE);

  function glGains(dim: number | undefined) {
    const stub = createGlStub();
    const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 512, height: 512 }).canvas, rig, fakeAssets(rig));
    stub.reset();
    renderer.draw(poses, look, { t: 1, reducedMotion: false, ...(dim === undefined ? {} : { dim }) });
    const gains = stub.log
      .filter(([n, a]) => n === "uniform3f" && (a[0] as { uniform?: string } | null)?.uniform === "u_gain")
      .map(([, a]) => Number(a[1]));
    return new Map(poses.map((p, i) => [p.name, gains[i] ?? NaN]));
  }

  function filters(dim: number | undefined): string[] {
    const ctx2d = createCtx2dStub();
    const renderer = createRenderer(createCanvasStub({ webgl2: "null", ctx2d, width: 512, height: 512 }).canvas, rig, fakeAssets(rig));
    renderer.draw(poses, look, { t: 1, reducedMotion: false, ...(dim === undefined ? {} : { dim }) });
    return ctx2d.filters;
  }

  it("draws exactly as before with no dim or dim 0", () => {
    expect(glGains(0)).toEqual(glGains(undefined));
    expect(filters(0)).toEqual(filters(undefined));
  });

  it("GL: at full dim the emissive eyes keep their gain and every other layer is darker", () => {
    const lit = glGains(undefined);
    const dark = glGains(1);
    let eyes = 0;
    for (const p of poses) {
      const layer = rig.layers.find((l) => l.name === p.name);
      if (layer === undefined) continue;
      const was = lit.get(p.name) ?? 0;
      const now = dark.get(p.name) ?? 0;
      if (layer.kind === "eye" && isEmissive(layer)) {
        eyes += 1;
        expect(now).toBeCloseTo(was, 9);
      } else if (was > 0) expect(now).toBeCloseTo(was * DIM_FLOOR, 9);
    }
    expect(eyes).toBeGreaterThan(0);
  });

  it("canvas2D agrees: emissive eyes unfiltered, the rest at brightness(DIM_FLOOR x their tint)", () => {
    const lit = filters(undefined);
    const dark = filters(1);
    poses.forEach((p, i) => {
      const layer = rig.layers.find((l) => l.name === p.name);
      if (layer === undefined) return;
      if (layer.kind === "eye" && isEmissive(layer)) expect(dark[i]).toBe(lit[i]);
      else expect(dark[i]).toBe(`brightness(${(p.tint * DIM_FLOOR).toFixed(4)})`);
    });
  });
});
