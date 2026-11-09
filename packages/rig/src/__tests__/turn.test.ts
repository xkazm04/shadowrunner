// Rig.turn and Look.turn (perfection-pass V2): `warp` and `light` in [0, 1]; validateRig reports a bad
// one as bad_shape at its path and keeps a good one, serializeRig writes it back, readLook drops a bad
// one and keeps the look. turnStrength: look wins field by field, absent is the default, with the
// art rules (pixel art 0, no measured mouth TURN_WARP_HARD). turnHead: membership by follow chain,
// the face from the eyes.
import { describe, expect, it } from "vitest";
import { defaultLook } from "../look.js";
import { readLook } from "../readLook.js";
import { serializeRig } from "../serialize.js";
import { TURN_DEFAULT, TURN_WARP_HARD, turnHead, turnStrength } from "../turn.js";
import type { Layer, Rig } from "../types.js";
import { parseRigJson, validateRig } from "../validate.js";
import { readRigTurn } from "../validateMotion.js";

let z = 0;
const layer = (name: string, kind: Layer["kind"], bbox: Layer["bbox"], follow?: string): Layer => ({ name, z: (z += 1), kind, file: `${name}.png`, bbox, anchor: [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3]], ...(follow === undefined ? {} : { follow }) });

const RIG: Rig = {
  version: 1,
  id: "t",
  name: "T",
  width: 200,
  height: 200,
  source: "forge",
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers: [
    layer("background", "static", [0, 0, 200, 200]),
    layer("torso", "body", [20, 120, 160, 80]),
    layer("head", "head", [40, 10, 120, 140]),
    layer("jaw", "jaw", [80, 100, 40, 20], "head"),
    layer("eye_l", "eye", [70, 60, 20, 10], "head"),
    layer("eye_r", "eye", [110, 60, 20, 10], "head"),
    layer("hat", "accessory", [50, 0, 100, 30], "head"),
    layer("feather", "accessory", [140, 0, 10, 20], "hat"),
    layer("collar", "accessory", [60, 130, 80, 10], "torso"),
  ],
  mouth: { cx: 100, lineY: 110, width: 30 },
};

describe("Rig.turn / Look.turn", () => {
  it("keeps warp and light in [0, 1] and round-trips them", () => {
    for (const turn of [{ warp: 0 }, { light: 1 }, { warp: 0.25, light: 0.75 }, {}]) {
      const result = validateRig({ ...RIG, turn });
      expect(result.ok && result.value.turn).toEqual(turn);
      const back = parseRigJson(serializeRig({ ...RIG, turn }));
      expect(back.ok && back.value.turn).toEqual(turn);
    }
    const none = validateRig(RIG);
    expect(none.ok && "turn" in none.value).toBe(false);
  });

  it("reports a bad one as bad_shape at its path", () => {
    for (const [turn, path] of [[{ warp: 1.5 }, "$.turn.warp"], [{ light: -0.1 }, "$.turn.light"], [{ warp: "1" }, "$.turn.warp"], [true, "$.turn"]] as const) {
      const result = validateRig({ ...RIG, turn });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code: "bad_shape", path }));
    }
    expect(readRigTurn({ light: Number.NaN }, "$.turn").problems).toHaveLength(1);
  });

  it("readLook keeps a good turn and drops a bad one, never the look", () => {
    const look = defaultLook(RIG);
    expect(readLook({ ...look, turn: { warp: 0, light: 0.4 } })?.turn).toEqual({ warp: 0, light: 0.4 });
    const bad = readLook({ ...look, turn: { warp: 3 } });
    expect(bad).toBeDefined();
    expect(bad !== undefined && "turn" in bad).toBe(false);
  });
});

describe("turnStrength", () => {
  it("defaults, look over rig field by field, clamped", () => {
    expect(turnStrength(RIG, {})).toEqual(TURN_DEFAULT);
    expect(turnStrength({ ...RIG, turn: { warp: 0.2, light: 0 } }, { turn: { warp: 0.9 } })).toEqual({ warp: 0.9, light: 0 });
    expect(turnStrength(RIG, { turn: { warp: 7, light: -1 } })).toEqual({ warp: 1, light: 0 });
  });

  it("lowers only the default bend: pixel art 0, a head without a measured mouth TURN_WARP_HARD", () => {
    expect(turnStrength({ ...RIG, mouth: { cx: 100, lineY: 110, width: 30, cell: 4 } }, {})).toEqual({ warp: 0, light: TURN_DEFAULT.light });
    const noMouth: Rig = { ...RIG };
    delete noMouth.mouth;
    expect(turnStrength(noMouth, {})).toEqual({ warp: TURN_WARP_HARD, light: TURN_DEFAULT.light });
    expect(turnStrength({ ...noMouth, turn: { warp: 0.8 } }, {}).warp).toBe(0.8);
  });
});

describe("turnHead", () => {
  it("the head and everything following it, at any depth; the body's chain stays off", () => {
    const found = turnHead(RIG);
    expect(found?.head.name).toBe("head");
    expect([...(found?.members ?? [])].sort()).toEqual(["eye_l", "eye_r", "feather", "hat", "head", "jaw"]);
    expect(turnHead(RIG)).toBe(found);
  });

  it("puts the face between the eyes, below the eye line, never wider or taller than the head", () => {
    const face = turnHead(RIG)?.face;
    // Eyes span x 70..130 (half 30) at y 65: rx = 1.6 * 30 = 48, ry = 1.3 * 48.
    expect(face?.cx).toBe(100);
    expect(face?.rx).toBeCloseTo(48, 9);
    expect(face?.ry).toBeCloseTo(62.4, 9);
    expect(face?.cy).toBeCloseTo(65 + 0.15 * 62.4, 9);
    const wide = turnHead({ layers: RIG.layers.map((l) => (l.kind === "eye" ? { ...l, bbox: [l.name === "eye_l" ? 0 : 180, 60, 20, 10] as Layer["bbox"] } : l)) });
    expect(wide?.face.rx).toBe(60);
    expect(wide?.face.ry).toBe(70);
  });

  it("a head without eyes uses its bbox; a rig without a head has none; a cycle ends the chain", () => {
    expect(turnHead({ layers: RIG.layers.filter((l) => l.kind !== "eye") })?.face).toEqual({ cx: 100, cy: 80, rx: 60, ry: 70 });
    expect(turnHead({ layers: RIG.layers.filter((l) => l.kind !== "head") })).toBeUndefined();
    const cyclic = turnHead({ layers: [...RIG.layers, layer("a", "accessory", [0, 0, 5, 5], "b"), layer("b", "accessory", [0, 0, 5, 5], "a")] });
    expect(cyclic?.members.has("a")).toBe(false);
  });
});
