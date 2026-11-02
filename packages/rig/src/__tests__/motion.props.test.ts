// Layer motion properties (cast-forge task 1, design.md "Testing strategy"): offsets bounded by
// amp, periodic in 1/freq, `still` gives the identity (the pose of the same rig without motion),
// float is not inherited by followers, and poseLayers stays deterministic.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { motionAt, phaseFromName } from "../motion.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Layer, Look, Motion, Rig } from "../types.js";
import { arbFloat, arbPalette, arbPulse, nth, rigArb } from "./arb.js";

const EPS = 1e-6;
const between = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 100_000 }).map((i) => min + ((max - min) * i) / 100_000);
const arbT = between(0, 600);
const arbCanvas = fc.tuple(fc.integer({ min: 16, max: 4096 }), fc.integer({ min: 16, max: 4096 }));

const lookOf = (rig: Rig): Look => ({ palette: rig.palette, hidden: [], emotion: "neutral" });
const driveAt = (t: number, still?: boolean): Drive => ({ t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...(still === undefined ? {} : { still }) });
const without = (layer: Layer, key: "motion" | "visible"): Layer => Object.fromEntries(Object.entries(layer).filter(([k]) => k !== key)) as Layer;
const withoutMotion = (layer: Layer): Layer => without(layer, "motion");
const strip = (rig: Rig): Rig => ({ ...rig, layers: rig.layers.map(withoutMotion) });
const byName = (poses: LayerPose[]): Map<string, LayerPose> => new Map(poses.map((p) => [p.name, p]));
const visible = (rig: Rig): Rig => ({ ...rig, layers: rig.layers.map((layer) => without(layer, "visible")) });

describe("motionAt", () => {
  it("float offsets are bounded by amp and rot_deg; pulse gain stays in [1, 1 + amp]", () => {
    const motion = arbCanvas.chain(([w, h]) => fc.record({ float: arbFloat(w, h), pulse: arbPulse }));
    fc.assert(
      fc.property(motion, arbT, (m: Required<Motion>, t) => {
        const o = motionAt(m, t);
        expect(Math.abs(o.dx)).toBeLessThanOrEqual(m.float.amp[0] + EPS);
        expect(Math.abs(o.dy)).toBeLessThanOrEqual(m.float.amp[1] + EPS);
        expect(Math.abs(o.rotation)).toBeLessThanOrEqual(((m.float.rot_deg ?? 0) * Math.PI) / 180 + EPS);
        expect(o.gain).toBeGreaterThanOrEqual(1 - EPS);
        expect(o.gain).toBeLessThanOrEqual(1 + m.pulse.amp + EPS);
      }),
    );
  });

  it("is periodic in 1 / freq, for float and for pulse", () => {
    const motion = arbCanvas.chain(([w, h]) => fc.oneof(arbFloat(w, h).map((float): Motion => ({ float })), arbPulse.map((pulse): Motion => ({ pulse }))));
    fc.assert(
      fc.property(motion, arbT, fc.integer({ min: 1, max: 3 }), (m, t, n) => {
        const freq = m.float?.freq ?? m.pulse?.freq ?? 1;
        const a = motionAt(m, t);
        const b = motionAt(m, t + n / freq);
        // Scale the tolerance to the amplitudes: sin of a large argument loses some low bits.
        const tol = 1e-6 * (1 + Math.max(...(m.float?.amp ?? [0])));
        expect(Math.abs(a.dx - b.dx)).toBeLessThanOrEqual(tol);
        expect(Math.abs(a.dy - b.dy)).toBeLessThanOrEqual(tol);
        expect(Math.abs(a.rotation - b.rotation)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(a.gain - b.gain)).toBeLessThanOrEqual(1e-6);
      }),
    );
  });

  it("moves at all: a float with amp y > 0 is at +amp[1] at w = 0 and -amp[1] half a period later", () => {
    const m: Motion = { float: { amp: [2, 4], freq: 0.5, rot_deg: 3 } };
    expect(motionAt(m, 0).dy).toBeCloseTo(4, 9);
    expect(motionAt(m, 1).dy).toBeCloseTo(-4, 9);
    expect(motionAt(m, 0.5).dx).toBeCloseTo(2, 9);
    expect(motionAt(m, 0.5).rotation).toBeCloseTo((-3 * Math.PI) / 180, 9);
    expect(motionAt({ pulse: { amp: 0.5, freq: 1, phase: 0.25 } }, 0).gain).toBeCloseTo(1.5, 9);
  });

  it("still, absent and non-finite t give no motion", () => {
    const motion = arbCanvas.chain(([w, h]) => fc.record({ float: arbFloat(w, h), pulse: arbPulse }));
    fc.assert(
      fc.property(motion, arbT, (m, t) => {
        expect(motionAt(m, t, true)).toEqual({ dx: 0, dy: 0, rotation: 0, gain: 1 });
        expect(motionAt(undefined, t)).toEqual({ dx: 0, dy: 0, rotation: 0, gain: 1 });
        expect(motionAt(m, Number.NaN)).toEqual({ dx: 0, dy: 0, rotation: 0, gain: 1 });
      }),
    );
  });

  it("phaseFromName is in [0, 1) and stable", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const phase = phaseFromName(name);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(1);
        expect(phaseFromName(name)).toBe(phase);
      }),
    );
  });
});

describe("poseLayers with motion", () => {
  const arbMoving = rigArb({ minLayers: 1, maxLayers: 6, motion: true }).map(visible);

  it("still gives the identity: the pose of the same rig without motion, at any t", () => {
    fc.assert(
      fc.property(arbMoving, arbT, (rig, t) => {
        expect(poseLayers(rig, lookOf(rig), driveAt(t, true))).toEqual(poseLayers(strip(rig), lookOf(rig), driveAt(t)));
      }),
    );
  });

  it("each layer moves off its still pose by at most its own amp (canvas px) and turns by at most rot_deg; followers do not inherit it", () => {
    fc.assert(
      fc.property(arbMoving, arbT, (rig, t) => {
        const moving = byName(poseLayers(rig, lookOf(rig), driveAt(t)));
        const still = byName(poseLayers(strip(rig), lookOf(rig), driveAt(t)));
        for (const layer of rig.layers) {
          const a = moving.get(layer.name);
          const b = still.get(layer.name);
          if (a === undefined || b === undefined) throw new Error(`no pose for ${layer.name}`);
          const [ampX, ampY] = layer.motion?.float?.amp ?? [0, 0];
          const tol = 1e-6 * (1 + Math.max(rig.width, rig.height, ...layer.anchor.map(Math.abs)));
          expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(ampX + tol);
          expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(ampY + tol);
          expect(Math.abs(a.rotation - b.rotation)).toBeLessThanOrEqual(((layer.motion?.float?.rot_deg ?? 0) * Math.PI) / 180 + 1e-9);
          expect(a.tint / b.tint).toBeLessThanOrEqual(1 + (layer.motion?.pulse?.amp ?? 0) + 1e-9);
          expect(a.tint / b.tint).toBeGreaterThanOrEqual(1 - 1e-9);
        }
      }),
    );
  });

  it("a follower of a floating parent poses as if the parent had no motion", () => {
    const scene = rigArb({ minLayers: 2, maxLayers: 6, motion: true })
      .map(visible)
      .filter((rig) => rig.layers.some((l) => l.follow !== undefined));
    fc.assert(
      fc.property(scene, arbT, (rig, t) => {
        // Only the parents move; every follower's motion is removed, so any change in it is inherited.
        const followers = new Set(rig.layers.flatMap((l) => (l.follow === undefined ? [] : [l.name])));
        const parentsOnly: Rig = { ...rig, layers: rig.layers.map((l) => (followers.has(l.name) ? withoutMotion(l) : l)) };
        const moving = byName(poseLayers(parentsOnly, lookOf(rig), driveAt(t)));
        const still = byName(poseLayers(strip(rig), lookOf(rig), driveAt(t)));
        for (const name of followers) expect(moving.get(name)).toEqual(still.get(name));
      }),
    );
  });

  it("the whole pose repeats after one period when every moving layer shares one freq", () => {
    const scene = fc.tuple(rigArb({ minLayers: 1, maxLayers: 6, motion: true }).map(visible), between(0.02, 2), arbT);
    fc.assert(
      fc.property(scene, ([rig, freq, t]) => {
        const same: Rig = {
          ...rig,
          layers: rig.layers.map((l): Layer => {
            if (l.motion === undefined) return l;
            const { float, pulse } = l.motion;
            return { ...l, motion: { ...(float === undefined ? {} : { float: { ...float, freq } }), ...(pulse === undefined ? {} : { pulse: { ...pulse, freq } }) } };
          }),
        };
        const a = poseLayers(same, lookOf(same), driveAt(t));
        const b = poseLayers(same, lookOf(same), driveAt(t + 1 / freq));
        a.forEach((p, i) => {
          const q = b[i];
          if (q === undefined) throw new Error("pose count changed");
          const tol = 1e-6 * (1 + Math.max(same.width, same.height));
          expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(tol);
          expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(tol);
          expect(Math.abs(p.rotation - q.rotation)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(p.tint - q.tint)).toBeLessThanOrEqual(1e-6);
        });
      }),
    );
  });

  it("is deterministic in t: two calls on the same inputs agree", () => {
    fc.assert(
      fc.property(arbMoving, arbT, arbPalette, (rig, t, palette) => {
        const look: Look = { palette, hidden: [nth(rig.layers, 0).name], emotion: "neutral" };
        expect(poseLayers(rig, look, driveAt(t))).toEqual(poseLayers(rig, look, driveAt(t)));
      }),
    );
  });
});
