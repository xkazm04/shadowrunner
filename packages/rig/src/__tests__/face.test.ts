// face-control contract: the iris layer kind, an eye layer's socket and closed art, an eye patch's
// socket and narrowed flag, Rig.face and Look.face all validate, survive serializeRig/readLook, and
// resolveFace fills defaults (Look over Rig over FACE_DEFAULTS) clamped to FACE_LIMITS.
import { describe, expect, it } from "vitest";
import { FACE_DEFAULTS, readFace, resolveFace, withFaceValue } from "../face.js";
import { readLook } from "../readLook.js";
import { serializeRig } from "../serialize.js";
import { parseRigJson, validateRig } from "../validate.js";

const PALETTE = { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" };

const rig = (extra: Record<string, unknown> = {}, eye: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: "f",
  name: "F",
  width: 1000,
  height: 1000,
  source: "forge",
  palette: PALETTE,
  layers: [
    { name: "head", z: 0, kind: "head", file: "head.png", bbox: [100, 100, 600, 700], anchor: [400, 800] },
    {
      name: "eye_l",
      z: 1,
      kind: "eye",
      file: "eye_l.png",
      bbox: [300, 300, 80, 40],
      anchor: [340, 320],
      follow: "head",
      socket: "eye_l.socket.png",
      closed: "eye_l.closed.png",
      variants: { joy: { file: "eye_l.joy.png", bbox: [300, 300, 80, 40], mode: "replace", socket: "eye_l.joy.socket.png", narrowed: true } },
      ...eye,
    },
    { name: "iris_l", z: 2, kind: "iris", file: "iris_l.png", bbox: [325, 305, 30, 30], anchor: [340, 320], follow: "eye_l" },
  ],
  ...extra,
});

const errors = (input: unknown): string[] => {
  const out = validateRig(input);
  return out.ok ? [] : out.errors.map((e) => `${e.code} ${e.path}`);
};

describe("face-control rig fields", () => {
  it("validates and round-trips iris, socket, closed, patch socket/narrowed and Rig.face", () => {
    const face = { gaze: { range: 0.4, habits: { chat: 0.2 } }, motion: { breath: 0.5 } };
    const out = validateRig(rig({ face }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const eye = out.value.layers[1];
    expect(eye?.socket).toBe("eye_l.socket.png");
    expect(eye?.closed).toBe("eye_l.closed.png");
    expect(eye?.variants?.joy).toEqual({ file: "eye_l.joy.png", bbox: [300, 300, 80, 40], mode: "replace", socket: "eye_l.joy.socket.png", narrowed: true });
    expect(out.value.layers[2]?.kind).toBe("iris");
    expect(out.value.face).toEqual(face);
    const again = parseRigJson(serializeRig(out.value));
    expect(again.ok && again.value).toEqual(out.value);
  });

  it("refuses socket/closed on a non-eye layer, a bad narrowed and an out-of-range face", () => {
    const bad = rig({ face: { gaze: { range: 3 } } });
    (bad.layers as Record<string, unknown>[])[0] = { name: "head", z: 0, kind: "head", file: "head.png", bbox: [100, 100, 600, 700], anchor: [400, 800], socket: "x.png" };
    expect(errors(bad)).toEqual(expect.arrayContaining([expect.stringContaining("$.layers[0].socket"), expect.stringContaining("$.face.gaze.range")]));
    expect(errors(rig({}, { variants: { joy: { file: "j.png", bbox: [300, 300, 80, 40], mode: "replace", narrowed: false } } }))).toEqual([
      expect.stringContaining("$.layers[1].variants.joy.narrowed"),
    ]);
  });
});

describe("resolveFace", () => {
  it("is FACE_DEFAULTS with no profile", () => {
    expect(resolveFace(undefined)).toEqual(FACE_DEFAULTS);
  });

  it("takes Look.face over Rig.face field by field and clamps", () => {
    const r = resolveFace({ face: { gaze: { range: 0.3, saccadeRate: 2 }, motion: { drift: 5 } } }, { face: { gaze: { range: 0.9 } } });
    expect(r.gaze.range).toBe(0.9);
    expect(r.gaze.saccadeRate).toBe(2);
    expect(r.motion.drift).toBe(2);
    expect(r.motion.breath).toBe(FACE_DEFAULTS.motion.breath);
  });

  it("withFaceValue sets and removes a field, pruning empty groups", () => {
    const f = withFaceValue(undefined, "motion.breath", 0.2);
    expect(f).toEqual({ motion: { breath: 0.2 } });
    expect(withFaceValue(f, "motion.breath", undefined)).toEqual({});
  });

  it("readFace keeps good fields and reports bad ones", () => {
    const r = readFace({ gaze: { range: 0.5, saccadeRate: "x" }, nope: 1 }, "$.face");
    expect(r.face).toEqual({ gaze: { range: 0.5 } });
    expect(r.problems.map((p) => p.path)).toEqual(["$.face.gaze.saccadeRate"]);
  });
});

describe("Look.face", () => {
  it("readLook keeps a good profile and drops bad fields, never the look", () => {
    const look = readLook({ palette: PALETTE, hidden: [], emotion: "neutral", face: { expression: { strength: 0.7 }, mouth: { emotion: 9 } } });
    expect(look?.face).toEqual({ expression: { strength: 0.7 } });
  });
});
