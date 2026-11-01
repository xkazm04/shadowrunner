// poseLayers examples (rig-core task 4.1): the design.md "Pose math" numbers, one case each.
import * as surface from "@sr/rig";
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { importLegacyLayers } from "../legacy.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Gesture, Layer, Look, Rig } from "../types.js";

const W = 1000;
const H = 800;
const REST: Drive = { t: 10, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const LOOK: Look = { palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" }, hidden: [], emotion: "neutral" };

const layer = (name: string, z: number, kind: Layer["kind"], extra: Partial<Layer> = {}): Layer => ({
  name,
  z,
  kind,
  file: `${name}.png`,
  bbox: [100 + z * 10, 200 + z * 10, 50, 40],
  anchor: [500, 400 + z],
  ...extra,
});

/** background, body, head (anchor 500,300), jaw/eye/monocle/crown following the head. */
const RIG: Rig = {
  version: 1,
  id: "test",
  name: "Test",
  width: W,
  height: H,
  source: "replay",
  fictional: true,
  palette: LOOK.palette,
  layers: [
    layer("bg", 0, "static"),
    layer("torso", 1, "body"),
    layer("head", 2, "head", { anchor: [500, 300] }),
    layer("jaw", 3, "jaw", { follow: "head", anchor: [500, 500] }),
    layer("eye", 4, "eye", { follow: "head", anchor: [450, 280] }),
    layer("monocle", 5, "accessory", { follow: "head", anchor: [450, 280] }),
    layer("shard", 6, "crown", { follow: "head", depth: 1, anchor: [500, 100] }),
  ],
};

const pose = (drive: Partial<Drive> = {}, rig: Rig = RIG, look: Look = LOOK): Map<string, LayerPose> =>
  new Map(poseLayers(rig, look, { ...REST, ...drive }).map((p) => [p.name, p]));

function get(poses: Map<string, LayerPose>, name: string): LayerPose {
  const p = poses.get(name);
  if (p === undefined) throw new Error(`no pose for ${name}`);
  return p;
}

const bboxOf = (name: string): Layer["bbox"] => {
  const found = RIG.layers.find((l) => l.name === name);
  if (found === undefined) throw new Error(name);
  return found.bbox;
};

/** Translation of a layer relative to its bbox. */
const shift = (poses: Map<string, LayerPose>, name: string): [number, number] => {
  const p = get(poses, name);
  const [x, y] = bboxOf(name);
  return [p.x - x, p.y - y];
};

/** A gesture at the peak of its curve (elapsed = half the 0.4 s duration). */
const peak = (name: Gesture): Partial<Drive> => ({ t: 10, gesture: { name, startedAt: 9.8 } });

describe("poseLayers at rest", () => {
  it("puts every layer at its bbox, unscaled, unrotated, opaque and untinted, in z order", () => {
    const poses = poseLayers(RIG, LOOK, REST);
    expect(poses.map((p) => p.name)).toEqual(RIG.layers.map((l) => l.name));
    for (const p of poses) {
      const [x, y] = bboxOf(p.name);
      expect(p).toEqual({ name: p.name, x, y, scale: [1, 1], rotation: 0, opacity: 1, tint: 1 });
    }
  });

  it("sorts by z, not by rig order", () => {
    const shuffled = { ...RIG, layers: [...RIG.layers].reverse() };
    expect(poseLayers(shuffled, LOOK, REST).map((p) => p.name)).toEqual(RIG.layers.map((l) => l.name));
  });

  it("omits layers in look.hidden and layers with visible: false", () => {
    const rig = { ...RIG, layers: RIG.layers.map((l) => (l.name === "monocle" ? { ...l, visible: false as const } : l)) };
    const names = [...pose({}, rig, { ...LOOK, hidden: ["torso", "nothing"] }).keys()];
    expect(names).toEqual(["bg", "head", "jaw", "eye", "shard"]);
  });
});

describe("parallax", () => {
  it("dx = yaw/22 * 0.04 * width * depth, with kind default depths", () => {
    const poses = pose({ headYaw: 11 });
    expect(shift(poses, "bg")).toEqual([0, 0]);
    expect(shift(poses, "torso")[0]).toBeCloseTo(0.5 * 0.04 * W * 0.3, 9);
    expect(shift(poses, "head")[0]).toBeCloseTo(0.5 * 0.04 * W * 0.6, 9);
  });

  it("dy = pitch/12 * 0.03 * height * depth", () => {
    expect(shift(pose({ headPitch: -6 }), "torso")[1]).toBeCloseTo(-0.5 * 0.03 * H * 0.3, 9);
  });

  it("clamps yaw to +-22 and pitch to +-12 degrees", () => {
    expect(shift(pose({ headYaw: 90 }), "head")).toEqual(shift(pose({ headYaw: 22 }), "head"));
    expect(shift(pose({ headPitch: -40 }), "head")).toEqual(shift(pose({ headPitch: -12 }), "head"));
    expect(shift(pose({ headYaw: Number.NaN, headPitch: Number.NaN }), "head")).toEqual([0, 0]);
  });

  it("followers take parallax from their own depth only, not added to the parent's", () => {
    const poses = pose({ headYaw: 22 });
    const unit = 0.04 * W;
    expect(shift(poses, "head")[0]).toBeCloseTo(unit * 0.6, 9);
    expect(shift(poses, "shard")[0]).toBeCloseTo(unit * 1, 9);
    expect(shift(poses, "eye")[0]).toBeCloseTo(unit * 0.7, 9);
  });

  it("followers still inherit the parent's gesture under yaw", () => {
    const poses = pose({ ...peak("recoil"), headYaw: 22 });
    expect(shift(poses, "eye")[0] - shift(pose(peak("recoil")), "eye")[0]).toBeCloseTo(0.04 * W * 0.7, 9);
    expect(get(poses, "eye").scale[0]).toBeCloseTo(0.96, 12);
  });
});

describe("jaw and blink", () => {
  it("drops the jaw by jawOpen * 0.06 * height, clamped to [0, 1]", () => {
    expect(shift(pose({ jawOpen: 0.5 }), "jaw")).toEqual([0, 0.5 * 0.06 * H]);
    expect(shift(pose({ jawOpen: 3 }), "jaw")).toEqual([0, 0.06 * H]);
    expect(shift(pose({ jawOpen: -1 }), "jaw")).toEqual([0, 0]);
    expect(shift(pose({ jawOpen: 1 }), "head")).toEqual([0, 0]);
  });

  it("drops along the head's down axis under tilt, by the same canvas px", () => {
    const rad = (5 * Math.PI) / 180;
    const [x0, y0] = shift(pose(peak("tilt")), "jaw");
    const [x1, y1] = shift(pose({ ...peak("tilt"), jawOpen: 1 }), "jaw");
    expect(x1 - x0).toBeCloseTo(-Math.sin(rad) * 0.06 * H, 9);
    expect(y1 - y0).toBeCloseTo(Math.cos(rad) * 0.06 * H, 9);
  });

  it("caps the drop at 0.06 * height canvas px under lean_in's scale", () => {
    const closed = shift(pose(peak("lean_in")), "jaw");
    const open = shift(pose({ ...peak("lean_in"), jawOpen: 1 }), "jaw");
    expect(get(pose(peak("lean_in")), "jaw").scale[0]).toBeCloseTo(1.04, 12);
    expect(open[0] - closed[0]).toBeCloseTo(0, 9);
    expect(open[1] - closed[1]).toBeCloseTo(0.06 * H, 9);
  });

  it("does not pass the drop to the jaw's followers; a jaw following a jaw drops by its own amount", () => {
    const rig: Rig = {
      ...RIG,
      layers: [
        ...RIG.layers,
        layer("tooth", 7, "accessory", { follow: "jaw" }),
        layer("inner_jaw", 8, "jaw", { follow: "jaw" }),
      ],
    };
    const closed = pose({ ...peak("tilt") }, rig);
    const open = pose({ ...peak("tilt"), jawOpen: 1 }, rig);
    expect(get(open, "tooth")).toEqual(get(closed, "tooth"));
    for (const name of ["jaw", "inner_jaw"]) {
      const dx = get(open, name).x - get(closed, name).x;
      const dy = get(open, name).y - get(closed, name).y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.06 * H, 9);
    }
  });

  it("squashes only eye layers to y-scale 1 - 0.9 * blink", () => {
    const poses = pose({ blink: 1 });
    expect(get(poses, "eye").scale[0]).toBe(1);
    expect(get(poses, "eye").scale[1]).toBeCloseTo(0.1, 12);
    expect(get(poses, "monocle").scale).toEqual([1, 1]);
    expect(get(pose({ blink: 0.5 }), "eye").scale[1]).toBeCloseTo(0.55, 12);
    expect(get(pose({ blink: 9 }), "eye").scale[1]).toBeCloseTo(0.1, 12);
  });
});

describe("gestures (half-sine over 0.4 s, values at the peak)", () => {
  it("nod adds +6 degrees of pitch before the clamp", () => {
    expect(shift(pose(peak("nod")), "torso")[1]).toBeCloseTo(0.5 * 0.03 * H * 0.3, 9);
    expect(shift(pose({ ...peak("nod"), headPitch: 10 }), "torso")[1]).toBeCloseTo(0.03 * H * 0.3, 9);
  });

  it("tilt rotates the head 5 degrees about its anchor and carries its followers", () => {
    const poses = pose(peak("tilt"));
    const rad = (5 * Math.PI) / 180;
    expect(get(poses, "head").rotation).toBeCloseTo(rad, 12);
    expect(shift(poses, "head")[0]).toBeCloseTo(0, 9);
    expect(get(poses, "jaw").rotation).toBeCloseTo(rad, 12);
    expect(get(poses, "torso").rotation).toBe(0);
    // The jaw anchor (500, 500) sits 200 px below the head anchor (500, 300).
    const [dx, dy] = shift(poses, "jaw");
    expect(dx).toBeCloseTo(-200 * Math.sin(rad), 9);
    expect(dy).toBeCloseTo(200 * Math.cos(rad) - 200, 9);
  });

  it("lean_in scales the head group by 1.04; recoil by 0.96 and lifts it by 1% of height", () => {
    expect(get(pose(peak("lean_in")), "head").scale).toEqual([1.04, 1.04]);
    expect(get(pose(peak("lean_in")), "eye").scale[0]).toBeCloseTo(1.04, 12);
    const recoil = pose(peak("recoil"));
    expect(get(recoil, "head").scale[0]).toBeCloseTo(0.96, 12);
    expect(shift(recoil, "head")).toEqual([0, -0.01 * H]);
    expect(get(recoil, "torso").scale).toEqual([1, 1]);
  });

  it("glare raises eye tint to 1.6; flare raises the emissive kinds to 2.0", () => {
    const glare = pose(peak("glare"));
    expect(get(glare, "eye").tint).toBeCloseTo(1.6, 12);
    expect(get(glare, "monocle").tint).toBe(1);
    const flare = pose(peak("flare"));
    for (const name of ["eye", "monocle", "shard"]) expect(get(flare, name).tint).toBeCloseTo(2, 12);
    for (const name of ["bg", "torso", "head", "jaw"]) expect(get(flare, name).tint).toBe(1);
  });

  it("has no effect before it starts or after 0.4 s, and eases in", () => {
    const at = (elapsed: number): number => get(pose({ t: 10, gesture: { name: "glare", startedAt: 10 - elapsed } }), "eye").tint;
    expect(at(-0.01)).toBe(1);
    expect(at(0.41)).toBe(1);
    expect(at(0)).toBe(1);
    expect(at(0.1)).toBeCloseTo(1 + 0.6 * Math.sin(Math.PI / 4), 12);
  });
});

describe("public surface", () => {
  it("@sr/rig re-exports pose.ts", () => {
    expect(surface.poseLayers).toBe(poseLayers);
    expect(surface.GESTURE_DURATION_S).toBe(0.4);
  });
});

describe("Malakor", () => {
  it("poses all 18 imported layers in z order", () => {
    const imported = importLegacyLayers(layersJson, specJson);
    if (!imported.ok) throw new Error("import failed");
    const { rig } = imported.value;
    const poses = poseLayers(rig, LOOK, { ...REST, headYaw: 15, jawOpen: 0.4, blink: 0.3, gesture: { name: "tilt", startedAt: 9.9 } });
    expect(poses.map((p) => p.name)).toEqual([...rig.layers].sort((a, b) => a.z - b.z).map((l) => l.name));
    for (const p of poses) for (const v of [p.x, p.y, ...p.scale, p.rotation, p.tint]) expect(Number.isFinite(v)).toBe(true);
  });
});
