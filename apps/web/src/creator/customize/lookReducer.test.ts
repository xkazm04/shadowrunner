import { defaultLook, FACE_FIELDS, FACE_LIMITS, faceValue, readFace, resolveFace, type Emotion, type Look, type Palette } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { lookReducer, normalizeHex, type LookAction } from "./lookReducer";

const EMOTIONS: Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];
const KEYS: (keyof Palette)[] = ["glow", "eye", "rim", "mouth"];
const LAYERS = testRig().layers.map((l) => l.name);
const HEX6 = /^#[0-9a-f]{6}$/;

const hexArb = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);
const lookArb: fc.Arbitrary<Look> = fc.record({
  palette: fc.record({ glow: hexArb, eye: hexArb, rim: hexArb, mouth: hexArb }),
  hidden: fc.subarray(LAYERS).map((names) => [...names].sort()),
  emotion: fc.constantFrom(...EMOTIONS),
});
const anyValueArb = fc.oneof(
  hexArb,
  hexArb.map((h) => h.toUpperCase()),
  hexArb.map((h) => h.slice(1)),
  fc.string(),
  fc.constantFrom("#fff", "red", "#12345g", "", "#1234567"),
);
const actionArb: fc.Arbitrary<LookAction> = fc.oneof(
  fc.record({ type: fc.constant("palette" as const), key: fc.constantFrom(...KEYS), value: anyValueArb }),
  fc.record({ type: fc.constant("toggle" as const), layer: fc.constantFrom(...LAYERS, "not_a_layer") }),
  fc.record({ type: fc.constant("emotion" as const), emotion: fc.constantFrom(...EMOTIONS) }),
  fc.constant({ type: "reset" as const, rig: testRig() }),
  fc.record({
    type: fc.constant("face" as const),
    field: fc.constantFrom(...FACE_FIELDS),
    value: fc.oneof(fc.double({ min: -1, max: 5, noNaN: true }), fc.constantFrom(Number.NaN, 1, 0.6, 0.3)),
    rig: fc.constant(testRig()),
  }),
  fc.constant({ type: "faceReset" as const }),
);

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("lookReducer properties", () => {
  it("never mutates its input (deep-frozen look and action)", () => {
    fc.assert(
      fc.property(lookArb, fc.array(actionArb, { maxLength: 8 }), (look, actions) => {
        const before = structuredClone(look);
        let current = deepFreeze(look);
        for (const action of actions) current = deepFreeze(lookReducer(current, deepFreeze(action)));
        expect(look).toEqual(before);
      }),
    );
  });

  it("keeps every palette value #rrggbb, whatever the input", () => {
    fc.assert(
      fc.property(lookArb, fc.array(actionArb, { maxLength: 12 }), (look, actions) => {
        const end = actions.reduce(lookReducer, look);
        for (const key of KEYS) expect(end.palette[key]).toMatch(HEX6);
      }),
    );
  });

  it("toggle twice is the identity", () => {
    fc.assert(
      fc.property(lookArb, fc.constantFrom(...LAYERS, "not_a_layer"), (look, layer) => {
        const twice = lookReducer(lookReducer(look, { type: "toggle", layer }), { type: "toggle", layer });
        expect(twice).toEqual(look);
      }),
    );
  });

  it("reset equals defaultLook(rig) from any look", () => {
    fc.assert(
      fc.property(lookArb, fc.array(actionArb, { maxLength: 6 }), (look, actions) => {
        const rig = testRig();
        expect(lookReducer(actions.reduce(lookReducer, look), { type: "reset", rig })).toEqual(defaultLook(rig));
      }),
    );
  });
});

describe("lookReducer examples", () => {
  const base = defaultLook(testRig());

  it("writes a palette key in lower case and refuses a non-colour", () => {
    expect(lookReducer(base, { type: "palette", key: "eye", value: "#A8EBD0" }).palette.eye).toBe("#a8ebd0");
    expect(lookReducer(base, { type: "palette", key: "eye", value: "teal" })).toBe(base);
  });

  it("hides and shows a layer through look.hidden", () => {
    const hidden = lookReducer(base, { type: "toggle", layer: "monocle" });
    expect(hidden.hidden).toEqual(["monocle"]);
    expect(lookReducer(hidden, { type: "toggle", layer: "monocle" }).hidden).toEqual([]);
  });

  it("sets the emotion and drops a pinned gesture", () => {
    const pinned: Look = { ...base, gesture: "nod" };
    const next = lookReducer(pinned, { type: "emotion", emotion: "furious" });
    expect(next.emotion).toBe("furious");
    expect("gesture" in next).toBe(false);
  });

  it("normalizeHex", () => {
    expect(normalizeHex(" ABCDEF ")).toBe("#abcdef");
    expect(normalizeHex("#abc")).toBeUndefined();
  });
});

describe("lookReducer face (face-control)", () => {
  const rig = { ...testRig(), face: { gaze: { range: 0.4 } } };
  const base = defaultLook(rig);

  it("keeps look.face minimal and valid whatever the actions: no own value, no empty group, within FACE_LIMITS", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 12 }), (actions) => {
        const end = actions.reduce(lookReducer, defaultLook(testRig()));
        if (end.face === undefined) return;
        expect(readFace(end.face, "face")).toEqual({ face: end.face, problems: [] });
        const own = resolveFace(testRig());
        for (const field of FACE_FIELDS) expect(faceValue(end.face, field)).not.toBe(faceValue(own, field));
      }),
    );
  });

  it("sets a field, clamps to FACE_LIMITS, refuses NaN, drops a field set back to the character's own", () => {
    const wide = lookReducer(base, { type: "face", field: "gaze.range", value: 0.9, rig });
    expect(wide.face).toEqual({ gaze: { range: 0.9 } });
    expect(lookReducer(base, { type: "face", field: "motion.drift", value: 9, rig }).face).toEqual({ motion: { drift: FACE_LIMITS["motion.drift"][1] } });
    expect(lookReducer(wide, { type: "face", field: "gaze.range", value: Number.NaN, rig })).toBe(wide);
    expect("face" in lookReducer(wide, { type: "face", field: "gaze.range", value: 0.4, rig })).toBe(false);
    // The default stands in for a field the rig leaves out.
    expect("face" in lookReducer(base, { type: "face", field: "motion.breath", value: 0.3, rig })).toBe(false);
  });

  it("other actions keep look.face (a copy); faceReset and reset delete it", () => {
    const tuned = lookReducer(base, { type: "face", field: "mouth.emotion", value: 1.4, rig });
    const moody = lookReducer(tuned, { type: "emotion", emotion: "grim" });
    expect(moody.face).toEqual({ mouth: { emotion: 1.4 } });
    expect(moody.face).not.toBe(tuned.face);
    expect("face" in lookReducer(moody, { type: "faceReset" })).toBe(false);
    expect(lookReducer(base, { type: "faceReset" })).toBe(base);
    expect("face" in lookReducer(moody, { type: "reset", rig })).toBe(false);
  });
});
