// cast-face-pass in the pose: on pixel art (`mouth.cell`) the iris's gaze offset steps by whole
// cells; a rig without a cell is unchanged. A closed-only eye (closed art, no socket, no iris) blinks
// by its closed art, on the drive's blink and on its own motion.blink.
import { describe, expect, it } from "vitest";
import { cellOf, snapCell } from "../eyes.js";
import { OWN_BLINK_S } from "../motion.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Look, Rig } from "../types.js";

const REST: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const LOOK: Look = { palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" }, hidden: [], emotion: "neutral" };
const RIG: Rig = {
  version: 1,
  id: "px",
  name: "Px",
  width: 1024,
  height: 1024,
  source: "replay",
  palette: LOOK.palette,
  layers: [
    { name: "head", z: 1, kind: "head", file: "head.png", bbox: [200, 200, 600, 600], anchor: [500, 700] },
    { name: "eye_l", z: 2, kind: "eye", file: "eye_l.png", bbox: [400, 400, 70, 50], anchor: [435, 425], follow: "head", socket: "eye_l.socket.png", closed: "eye_l.closed.png" },
    { name: "iris_l", z: 3, kind: "iris", file: "iris_l.png", bbox: [428, 418, 14, 14], anchor: [435, 425], follow: "eye_l" },
    { name: "eye_r", z: 4, kind: "eye", file: "eye_r.png", bbox: [560, 400, 70, 50], anchor: [595, 425], follow: "head", closed: "eye_r.closed.png", motion: { blink: { freq: 0.25, phase: 0.5 } } },
  ],
};
const PIXEL: Rig = { ...RIG, mouth: { cx: 512, lineY: 600, width: 90, cell: 7.1 } };
const SOCKETS = new Map([["eye_l", { hx: 30, hy: 20 }]]);
const at = (poses: LayerPose[], name: string): LayerPose => {
  const p = poses.find((q) => q.name === name);
  if (p === undefined) throw new Error(name);
  return p;
};
const pose = (rig: Rig, drive: Partial<Drive>): LayerPose[] => poseLayers(rig, LOOK, { ...REST, ...drive }, { sockets: SOCKETS });

describe("pixel snap of the iris gaze", () => {
  it("cellOf reads a usable mouth.cell; snapCell rounds to whole cells", () => {
    expect(cellOf(PIXEL)).toBe(7.1);
    expect(cellOf(RIG)).toBeUndefined();
    expect(cellOf({ mouth: { cx: 0, lineY: 0, width: 1, cell: -2 } })).toBeUndefined();
    expect(snapCell([10, -4], 7.1)).toEqual([7.1, -7.1]);
    expect(snapCell([10.3, -4], undefined)).toEqual([10.3, -4]);
  });

  it("the iris moves by whole cells on a pixel rig, smoothly without a cell", () => {
    for (const gx of [0.13, 0.4, -0.77, 1]) {
      const gaze = { x: gx, y: gx / 2 };
      const rest = at(pose(PIXEL, {}), "iris_l");
      const moved = at(pose(PIXEL, { gaze }), "iris_l");
      for (const d of [(moved.x - rest.x) / 7.1, (moved.y - rest.y) / 7.1]) expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-9);
      const smooth = at(pose(RIG, { gaze }), "iris_l");
      expect(Math.abs(moved.x - smooth.x)).toBeLessThanOrEqual(3.55 + 1e-9);
    }
    // Same gaze without a cell: the old, unsnapped offset (30 x 0.13 x 0.6 range).
    expect(at(pose(RIG, { gaze: { x: 0.13, y: 0 } }), "iris_l").x - 428).toBeCloseTo(30 * 0.13 * 0.6, 9);
  });
});

describe("closed-only eyes", () => {
  it("the drive's blink sets closed with no squash on an eye with closed art and no socket", () => {
    const shut = at(pose(RIG, { blink: 0.7 }), "eye_r");
    expect(shut.scale[1]).toBe(1);
    expect(shut.closed).toBeCloseTo(0.7, 12);
    expect(shut.opacity).toBe(1);
  });

  it("its own motion.blink drives its closure alone", () => {
    // eye_r's cycle is half a period ahead: at t = 2 + OWN_BLINK_S / 2 it is mid-blink, eye_l open.
    const poses = pose(RIG, { t: 2 + OWN_BLINK_S / 2 });
    expect(at(poses, "eye_r").closed).toBeCloseTo(1, 9);
    expect(at(poses, "eye_l").closed).toBeUndefined();
    expect(at(pose(RIG, { t: 1 }), "eye_r").closed).toBeUndefined();
  });
});
