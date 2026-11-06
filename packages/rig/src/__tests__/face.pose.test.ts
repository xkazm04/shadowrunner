// Face control in the pose (face-control WP-A, eyes.ts): the iris rides its eye and moves by the
// gaze in the eye's frame, closed-lid blinks, the narrowed-face squint, the glow on the iris, the
// profile's tilt / gesture / expression strength, and the breathing idle (and its gates).
import { describe, expect, it } from "vitest";
import { isEmissive, poseLayers, type Drive, type LayerPose } from "../pose.js";
import { BREATH_HZ, BREATH_RISE, irisOffset, squintOf, strengthen } from "../eyes.js";
import { resolveFace } from "../face.js";
import type { Layer, Look, Rig } from "../types.js";

const REST: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const LOOK: Look = { palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" }, hidden: [], emotion: "neutral" };

const eye: Layer = {
  name: "eye_l",
  z: 3,
  kind: "eye",
  file: "eye_l.png",
  bbox: [40, 40, 24, 16],
  anchor: [52, 48],
  follow: "head",
  socket: "eye_l.socket.png",
  closed: "eye_l.closed.png",
  motion: { pulse: { amp: 0.5, freq: 0.5 } },
  variants: { joy: { file: "eye_l.joy.png", bbox: [40, 40, 24, 16], mode: "replace", narrowed: true }, anger: { file: "eye_l.anger.png", bbox: [40, 40, 24, 16], mode: "replace" } },
};
const RIG: Rig = {
  version: 1,
  id: "face",
  name: "Face",
  width: 128,
  height: 128,
  source: "replay",
  palette: LOOK.palette,
  layers: [
    { name: "body", z: 0, kind: "body", file: "body.png", bbox: [0, 64, 128, 64], anchor: [64, 120] },
    { name: "head", z: 1, kind: "head", file: "head.png", bbox: [24, 16, 80, 80], anchor: [64, 90], follow: "body" },
    eye,
    { name: "iris_l", z: 4, kind: "iris", file: "iris_l.png", bbox: [48, 44, 8, 8], anchor: [52, 48], follow: "eye_l" },
    { name: "eye_r", z: 5, kind: "eye", file: "eye_r.png", bbox: [70, 40, 24, 16], anchor: [82, 48], follow: "head" },
  ],
};
const SOCKETS = new Map([["eye_l", { hx: 10, hy: 6 }]]);

const byName = (poses: LayerPose[], name: string): LayerPose => {
  const found = poses.find((p) => p.name === name);
  if (found === undefined) throw new Error(`no pose ${name}`);
  return found;
};
const pose = (drive: Partial<Drive>, look: Partial<Look> = {}, rig: Rig = RIG): LayerPose[] => poseLayers(rig, { ...LOOK, ...look }, { ...REST, ...drive }, { sockets: SOCKETS });

describe("iris pose (face-control)", () => {
  it("at rest the iris sits where it was cut; the gaze moves it by gaze x half extents x range in the eye's frame", () => {
    const rest = byName(pose({}), "iris_l");
    expect([rest.x, rest.y]).toEqual([48, 44]);
    const right = byName(pose({ gaze: { x: 1, y: -0.5 } }), "iris_l");
    expect(right.x - rest.x).toBeCloseTo(10 * 0.6, 9);
    expect(right.y - rest.y).toBeCloseTo(-6 * 0.5 * 0.6, 9);
    // Beyond the socket the gaze is clamped to 1.
    expect(byName(pose({ gaze: { x: 9, y: 0 } }), "iris_l").x - rest.x).toBeCloseTo(6, 9);
    // Unknown socket size: the iris rests.
    expect(byName(poseLayers(RIG, LOOK, { ...REST, gaze: { x: 1, y: 1 } }), "iris_l").x).toBe(48);
  });

  it("takes the eye's whole transform: the head's tilt turns the gaze offset with it and parallax matches the eye's", () => {
    const drive: Partial<Drive> = { t: 1, gesture: { name: "tilt", startedAt: 0.8 }, headYaw: 10, gaze: { x: 1, y: 0 } };
    const poses = pose(drive);
    const [e, i] = [byName(poses, "eye_l"), byName(poses, "iris_l")];
    expect(i.rotation).toBeCloseTo(e.rotation, 12);
    expect(i.rotation).not.toBe(0);
    // The iris's anchor is the eye's anchor moved by (6, 0) turned by the rotation.
    const [eyeX, eyeY] = [e.x - 40 + 52, e.y - 40 + 48];
    const [irisX, irisY] = [i.x - 48 + 52, i.y - 44 + 48];
    expect(irisX - eyeX).toBeCloseTo(6 * Math.cos(e.rotation) * e.scale[0], 9);
    expect(irisY - eyeY).toBeCloseTo(6 * Math.sin(e.rotation) * e.scale[0], 9);
    // An eye with a depth of its own: the iris shifts with the eye's parallax, not its kind's.
    const deep = { ...RIG, layers: RIG.layers.map((l) => (l.name === "eye_l" ? { ...l, depth: 0.9 } : l)) };
    const shifted = pose({ headYaw: 10 }, {}, deep);
    expect(byName(shifted, "iris_l").x - byName(pose({}, {}, deep), "iris_l").x).toBeCloseTo(byName(shifted, "eye_l").x - 40, 9);
  });

  it("is hidden with its eye", () => {
    expect(pose({}, { hidden: ["eye_l"] }).map((p) => p.name)).toEqual(["body", "head", "eye_r"]);
  });

  it("blink on an eye with closed art: no squash, `closed` carries the closure, the iris fades; others squash as before", () => {
    const poses = pose({ blink: 1 });
    expect(byName(poses, "eye_l").scale[1]).toBe(1);
    expect(byName(poses, "eye_l").closed).toBe(1);
    expect(byName(poses, "iris_l").opacity).toBe(0);
    expect(byName(poses, "eye_r").scale[1]).toBeCloseTo(0.1, 12);
    expect(byName(poses, "eye_r").closed).toBeUndefined();
    const open = pose({ blink: 0 });
    expect(byName(open, "eye_l").closed).toBeUndefined();
    expect(byName(open, "iris_l").opacity).toBe(1);
  });

  it("squint is skipped while a narrowed face shows, by its weight", () => {
    // amused = joy (narrowed), squint 0.15; irritated = anger (not narrowed), squint 0.25.
    expect(byName(pose({}, { emotion: "amused" }), "eye_l").scale[1]).toBe(1);
    expect(byName(pose({}, { emotion: "amused" }), "eye_r").scale[1]).toBeCloseTo(0.85, 12);
    expect(byName(pose({}, { emotion: "irritated" }), "eye_l").scale[1]).toBeCloseTo(0.75, 12);
    const half = byName(pose({}, { emotion: "amused", face: { expression: { strength: 0.5 } } }), "eye_l");
    expect(half.faces).toEqual([{ family: "joy", weight: 0.5 }]);
    expect(half.scale[1]).toBeCloseTo(1 - 0.15 * 0.5, 12);
    expect(squintOf(eye, undefined, 0.3)).toBe(0.3);
    expect(strengthen([{ family: "joy", weight: 1 }], 0)).toBeUndefined();
  });

  it("glow moves to the iris: a socketed eye gives no light by default, its pulse and glare go to the iris", () => {
    expect(isEmissive(eye)).toBe(false);
    expect(isEmissive({ kind: "eye" })).toBe(true);
    expect(isEmissive({ kind: "iris" })).toBe(true);
    expect(isEmissive({ kind: "iris", emissive: false })).toBe(false);
    const t = 0.5; // pulse at sin(pi/2): gain 1.5
    const glare = pose({ t, gesture: { name: "glare", startedAt: t - 0.2 } });
    expect(byName(glare, "eye_l").tint).toBe(1);
    expect(byName(glare, "iris_l").tint).toBeCloseTo(1.6 * 1.5, 9);
    expect(byName(pose({ t, still: true }), "iris_l").tint).toBe(1);
  });
});

describe("profile in the pose (face-control)", () => {
  const head = (look: Partial<Look>, drive: Partial<Drive> = {}): LayerPose => byName(pose(drive, look), "head");

  it("motion.tilt scales the mood's head tilt and pitch; motion.gesture the gesture peaks", () => {
    const smug = head({ emotion: "smug" }).rotation;
    expect(smug).toBeCloseTo((6 * Math.PI) / 180, 12);
    expect(head({ emotion: "smug", face: { motion: { tilt: 2 } } }).rotation).toBeCloseTo(2 * smug, 12);
    expect(head({ emotion: "smug", face: { motion: { tilt: 0 } } }).rotation).toBeCloseTo(0, 12);
    const nod = { t: 0.2, gesture: { name: "tilt" as const, startedAt: 0 } };
    expect(head({ face: { motion: { gesture: 0.5 } } }, nod).rotation).toBeCloseTo(head({}, nod).rotation / 2, 12);
  });

  it("breathing: a rig or look with a face profile (or irises) breathes, about the body group's root, off when still", () => {
    const t = 1 / (4 * BREATH_HZ); // sin = 1
    const amp = resolveFace(RIG).motion.breath;
    const legacy: Rig = { ...RIG, layers: RIG.layers.filter((l) => l.kind !== "iris") };
    const at = (rig: Rig, look: Partial<Look>, still = false): LayerPose => byName(poseLayers(rig, { ...LOOK, ...look }, { ...REST, t, still }), "body");
    const yOf = (rig: Rig, look: Partial<Look>, still = false): number => at(rig, look, still).y;
    expect(yOf(legacy, {})).toBe(64);
    // The body root rises (its anchor moves up) and swells about its anchor; the head inherits both.
    expect(yOf(RIG, {})).toBeCloseTo(64 - amp * BREATH_RISE * 128, 9);
    expect(at(RIG, {}).scale[1]).toBeCloseTo(1 + amp * 0.006, 12);
    expect(byName(poseLayers(RIG, LOOK, { ...REST, t }), "head").scale[0]).toBeCloseTo(1 + amp * 0.006, 12);
    expect(yOf(legacy, { face: { motion: { breath: 1 } } })).toBeCloseTo(64 - BREATH_RISE * 128, 9);
    expect(yOf(RIG, {}, true)).toBe(64);
    expect(yOf({ ...legacy, face: { motion: { breath: 0 } } }, {})).toBe(64);
  });

  it("irisOffset clamps the gaze and the range", () => {
    expect(irisOffset({ x: -2, y: 0.5 }, { hx: 10, hy: 4 }, 2)).toEqual([-10, 2]);
    expect(irisOffset(undefined, { hx: 10, hy: 4 }, 1)).toEqual([0, 0]);
    expect(irisOffset({ x: Number.NaN, y: 1 }, { hx: 10, hy: 4 }, 0.5)).toEqual([0, 2]);
  });
});
