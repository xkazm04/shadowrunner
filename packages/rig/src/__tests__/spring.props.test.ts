// Secondary motion in the pose (perfection-pass V1, spring.ts): `Drive.spring` absent, zero, under
// `still` or at strength 0 leaves every pose exactly as before; on every recorded rig (the thirteen
// cast and the forge Malakor) and the committed legacy Malakor, for any lag within the driver's
// bounds, registered face parts never move, a swing stays within SPRING_ROT_MAX of the springless
// pose, a part that only swings keeps its pin where it was and a part that moves stays within its
// bound, and a follower of a springing part stays pinned to it. Strength: look wins over rig.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { importLegacyLayers } from "../legacy.js";
import { defaultLook } from "../look.js";
import { isBrowLayer } from "../mood.js";
import { DEFAULT_DEPTH, poseLayers, springTargetOf, type Drive, type LayerPose } from "../pose.js";
import { SPRING_ROT_MAX, springParts, springStrength, type SpringChannels } from "../spring.js";
import type { Layer, Rig } from "../types.js";
import { replayRigs } from "./replayJobs.js";

const legacy = importLegacyLayers(layersJson, specJson);
if (!legacy.ok) throw new Error("malakor legacy import failed");
const RIGS: { slug: string; rig: Rig }[] = [...replayRigs(), { slug: "malakor-legacy", rig: legacy.value.rig }];
const depthOf = (layer: Layer): number => layer.depth ?? DEFAULT_DEPTH[layer.kind];
const ZERO: SpringChannels = { yaw: 0, pitch: 0, roll: 0, scale: 0, lift: 0, actDx: 0, actDy: 0, actRot: 0 };
const BASE: Drive = { t: 1.3, headYaw: 6, headPitch: -2, jawOpen: 0.2, blink: 0 };

/** Lags within the driver's per-channel bounds (state.ts SPRING_LAG_MAX). */
const lagArb = (actLayers: string[]): fc.Arbitrary<SpringChannels> =>
  fc
    .record({
      yaw: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
      pitch: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
      roll: fc.double({ min: -0.1, max: 0.1, noNaN: true }),
      scale: fc.double({ min: -0.05, max: 0.05, noNaN: true }),
      lift: fc.double({ min: -0.02, max: 0.02, noNaN: true }),
      actDx: fc.double({ min: -0.05, max: 0.05, noNaN: true }),
      actDy: fc.double({ min: -0.05, max: 0.05, noNaN: true }),
      actRot: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
      act: fc.constantFrom(undefined, ...actLayers),
    })
    .map(({ act, ...lag }) => (act === undefined ? lag : { ...lag, actLayer: act }));

const byName = (poses: LayerPose[]): Map<string, LayerPose> => new Map(poses.map((p) => [p.name, p]));
/** Where a pose takes the rest point q (render/frame.ts layerAffine): A' + R S (q - A). */
function posed(layer: Layer, pose: LayerPose, qx: number, qy: number): [number, number] {
  const [ax, ay] = layer.anchor;
  const dx = (qx - ax) * pose.scale[0];
  const dy = (qy - ay) * pose.scale[1];
  const c = Math.cos(pose.rotation);
  const s = Math.sin(pose.rotation);
  return [ax + pose.x - layer.bbox[0] + c * dx - s * dy, ay + pose.y - layer.bbox[1] + s * dx + c * dy];
}

describe("Drive.spring in poseLayers", () => {
  const sir = RIGS.find((r) => r.slug === "sir-vacant")?.rig as Rig;
  const lag: SpringChannels = { ...ZERO, yaw: 0.3, roll: 0.05, pitch: -0.2 };

  it("absent, all zero, under still or at strength 0: exactly the springless pose", () => {
    const look = defaultLook(sir);
    const without = poseLayers(sir, look, BASE);
    expect(poseLayers(sir, look, { ...BASE, spring: ZERO })).toEqual(without);
    expect(poseLayers(sir, look, { ...BASE, still: true, spring: lag })).toEqual(poseLayers(sir, look, { ...BASE, still: true }));
    expect(poseLayers(sir, { ...look, motion: { spring: 0 } }, { ...BASE, spring: lag })).toEqual(without);
    expect(poseLayers(sir, look, { ...BASE, spring: lag })).not.toEqual(without);
  });

  it("strength: the look's wins over the rig's, absent is 1, clamped to [0, 2]", () => {
    expect(springStrength({}, {})).toBe(1);
    expect(springStrength({ motion: { spring: 0 } }, {})).toBe(0);
    expect(springStrength({ motion: { spring: 0 } }, { motion: { spring: 1.5 } })).toBe(1.5);
    expect(springStrength({ motion: { spring: 2 } }, { motion: {} })).toBe(2);
    expect(springStrength({}, { motion: { spring: 9 } })).toBe(2);
    const rigOff: Rig = { ...sir, motion: { spring: 0 } };
    expect(poseLayers(rigOff, { ...defaultLook(sir), motion: { spring: 1 } }, { ...BASE, spring: lag })).toEqual(poseLayers(sir, defaultLook(sir), { ...BASE, spring: lag }));
  });

  it("the target at rest is the head's own: zero roll, scale and lift, no act", () => {
    const target = springTargetOf(sir, defaultLook(sir), { ...BASE, headYaw: 11 });
    expect(target).toEqual({ yaw: 0.5, pitch: expect.closeTo(-2 / 12, 12), roll: 0, scale: 0, lift: 0, actDx: 0, actDy: 0, actRot: 0 });
  });
});

describe.each(RIGS)("$slug: springs stay bounded and registered", ({ rig }) => {
  const look = defaultLook(rig);
  const { parts } = springParts(rig, depthOf);
  const layers = new Map(rig.layers.map((l) => [l.name, l]));
  const springs = (l: Layer): boolean => {
    const i = rig.layers.indexOf(l);
    return (parts[i]?.swing ?? 0) > 0 || (parts[i]?.move ?? 0) > 0;
  };
  const springingAncestor = (l: Layer): Layer | undefined => {
    for (let p = l.follow === undefined ? undefined : layers.get(l.follow), hops = 0; p !== undefined && hops < rig.layers.length; p = p.follow === undefined ? undefined : layers.get(p.follow), hops += 1) if (springs(p)) return p;
    return undefined;
  };
  const actLayers = rig.layers.filter((l) => l.kind === "accessory" || l.kind === "crown").map((l) => l.name);

  it("no eye, iris, jaw, brow, head, body or static layer gets a spring", () => {
    for (const [i, layer] of rig.layers.entries()) {
      const part = parts[i];
      if (layer.kind !== "accessory" && layer.kind !== "crown") expect(part?.swing ?? 0).toBe(0);
      if (isBrowLayer(layer)) expect(part?.swing ?? 0).toBe(0);
    }
  });

  it("for any lag: registered parts hold, swings within ROT_MAX, pins hold, moves bounded", () => {
    fc.assert(
      fc.property(lagArb(actLayers), fc.double({ min: 0, max: 2, noNaN: true }), (lag, strength) => {
        const drive: Drive = { ...BASE, spring: lag };
        const lk = { ...look, motion: { spring: strength } };
        const off = byName(poseLayers(rig, lk, BASE));
        const on = byName(poseLayers(rig, lk, drive));
        for (const layer of rig.layers) {
          const a = off.get(layer.name);
          const b = on.get(layer.name);
          if (a === undefined || b === undefined) continue;
          const parent = springingAncestor(layer);
          if (!springs(layer) && parent === undefined) {
            expect(b).toEqual(a);
            continue;
          }
          const i = rig.layers.indexOf(layer);
          const part = parts[i];
          if (parent === undefined) {
            expect(Math.abs(b.rotation - a.rotation)).toBeLessThanOrEqual(SPRING_ROT_MAX + 1e-9);
            const [ax, ay] = posed(layer, a, layer.anchor[0], layer.anchor[1]);
            const [bx, by] = posed(layer, b, layer.anchor[0], layer.anchor[1]);
            expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual((part?.move ?? 0) > 0 ? (part?.moveMax ?? 0) + 1e-6 : 1e-6);
          } else if ((part?.move ?? 0) === 0) {
            // A follower that only swings stays on the point of its springing parent it hangs from.
            const pa = off.get(parent.name);
            const pb = on.get(parent.name);
            if (pa === undefined || pb === undefined) continue;
            const [ox, oy] = posed(parent, pa, layer.anchor[0], layer.anchor[1]);
            const [nx, ny] = posed(parent, pb, layer.anchor[0], layer.anchor[1]);
            const [cx, cy] = posed(layer, a, layer.anchor[0], layer.anchor[1]);
            const [dx, dy] = posed(layer, b, layer.anchor[0], layer.anchor[1]);
            expect(Math.hypot(dx - cx - (nx - ox), dy - cy - (ny - oy))).toBeLessThan(1e-6);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});
