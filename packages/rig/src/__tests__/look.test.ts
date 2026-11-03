// Looks (rig-core task 5, req 5): defaultLook, applyLook non-mutation under deep-freeze (property),
// and the emotion table for all 10 emotions (design.md "Emotion table"). Task 6: resolveGesture
// precedence and the @sr/rig re-export of look.ts.
import * as surface from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyLook, defaultLook, EMOTION_TABLE, lookToEmotionDrive, resolveGesture } from "../look.js";
import { poseLayers, type Drive } from "../pose.js";
import type { Emotion, Gesture, Look, Rig } from "../types.js";
import { validateRig } from "../validate.js";
import { arbLayerName, arbPalette, rigArb } from "./arb.js";

const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
const EMOTIONS: readonly Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];

/** Looks that hide some of the rig's layers plus, sometimes, names the rig does not have. */
const arbLookFor = (rig: Rig): fc.Arbitrary<Look> =>
  fc
    .record(
      {
        palette: arbPalette,
        own: fc.subarray(rig.layers.map((l) => l.name)),
        stray: fc.array(arbLayerName, { maxLength: 3 }),
        emotion: fc.constantFrom(...EMOTIONS),
        gesture: fc.constantFrom(...GESTURES),
      },
      { requiredKeys: ["palette", "own", "stray", "emotion"] },
    )
    .map(({ own, stray, ...rest }): Look => ({ ...rest, hidden: [...own, ...stray] }));

const arbRigAndLook = rigArb().chain((rig) => fc.tuple(fc.constant(rig), arbLookFor(rig)));

/** Deep copy of plain data. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Every object and array reachable from `value`. */
function nodes(value: unknown, into = new Set<object>()): Set<object> {
  if (typeof value === "object" && value !== null && !into.has(value)) {
    into.add(value);
    for (const child of Object.values(value)) nodes(child, into);
  }
  return into;
}

describe("defaultLook (req 5.1)", () => {
  it("is the rig's palette, nothing hidden, neutral, no gesture", () => {
    fc.assert(
      fc.property(rigArb(), (rig) => {
        const look = defaultLook(deepFreeze(clone(rig)));
        // toEqual: fast-check records have a null prototype; key presence is checked below.
        expect(look).toEqual({ palette: rig.palette, hidden: [], emotion: "neutral" });
        expect("gesture" in look).toBe(false);
      }),
    );
  });

  it("does not alias the rig's palette", () => {
    fc.assert(
      fc.property(rigArb(), (rig) => {
        const look = defaultLook(rig);
        expect(look.palette).not.toBe(rig.palette);
      }),
    );
  });
});

describe("applyLook (req 5.2)", () => {
  it("never mutates its inputs (deep-freeze)", () => {
    fc.assert(
      fc.property(arbRigAndLook, ([rig, look]) => {
        const before = clone({ rig, look });
        const frozen = deepFreeze(clone({ rig, look }));
        applyLook(frozen.rig, frozen.look);
        expect(frozen).toStrictEqual(before);
      }),
    );
  });

  it("shares no object or array with its inputs", () => {
    fc.assert(
      fc.property(arbRigAndLook, ([rig, look]) => {
        const out = nodes(applyLook(rig, look));
        for (const input of nodes({ rig, look })) expect(out.has(input)).toBe(false);
      }),
    );
  });

  it("takes the look's palette and hides exactly the rig's hidden layers plus look.hidden", () => {
    fc.assert(
      fc.property(arbRigAndLook, ([rig, look]) => {
        const dressed = applyLook(rig, look);
        // toEqual: fast-check records have a null prototype.
        expect(dressed.palette).toEqual(look.palette);
        expect(dressed.layers.map((l) => l.name)).toStrictEqual(rig.layers.map((l) => l.name));
        rig.layers.forEach((layer, i) => {
          const hide = layer.visible === false || look.hidden.includes(layer.name);
          expect(dressed.layers[i]?.visible === false).toBe(hide);
          const rest = { ...dressed.layers[i] };
          const orig = { ...layer };
          delete rest.visible;
          delete orig.visible;
          expect(rest).toEqual(orig);
          expect(Object.keys(rest).sort()).toStrictEqual(Object.keys(orig).sort());
        });
        const withoutBody = (r: Rig): Partial<Rig> => {
          const copy: Partial<Rig> = { ...r };
          delete copy.palette;
          delete copy.layers;
          return copy;
        };
        const head = withoutBody(dressed);
        const origHead = withoutBody(rig);
        expect(head).toEqual(origHead);
        expect(Object.keys(head).sort()).toStrictEqual(Object.keys(origHead).sort());
      }),
    );
  });

  it("keeps a valid rig valid and poses the same layers as the look does", () => {
    const drive: Drive = { t: 0, headYaw: 10, headPitch: -5, jawOpen: 0.5, blink: 0.2 };
    fc.assert(
      fc.property(arbRigAndLook, ([rig, look]) => {
        const dressed = applyLook(rig, look);
        expect(validateRig(dressed).ok).toBe(true);
        // The emotion is not a rig field: it still poses (character-control "Moods"), so it is carried over.
        expect(poseLayers(dressed, { ...defaultLook(dressed), emotion: look.emotion }, drive)).toStrictEqual(poseLayers(rig, look, drive));
      }),
    );
  });
});

describe("lookToEmotionDrive (req 5.3, design.md emotion table)", () => {
  // character-control design.md "Moods": eyeGain, brow, gesture, headTilt, headPitch, squint, jawSet, glowGain, browLift.
  type Row = [Emotion, number, number, Gesture | undefined, number, number, number, number, number, number];
  const TABLE: readonly Row[] = [
    ["neutral", 1.0, 0, undefined, 0, 0, 0, 0, 1.0, 0],
    ["amused", 1.2, 1, "tilt", 4, 0, 0.15, 0.05, 1.1, 0.006],
    ["smug", 1.1, 2, "tilt", 6, -2, 0.25, 0, 1.1, 0.008],
    ["irritated", 1.3, -2, "glare", 0, 3, 0.25, 0, 1.2, -0.008],
    ["furious", 2.0, -3, "flare", 0, 5, 0.35, 0.1, 1.6, -0.012],
    ["delighted", 1.5, 2, "nod", -3, -2, 0.2, 0.2, 1.3, 0.01],
    ["bored", 0.7, -1, undefined, 5, 4, 0.35, 0, 0.7, -0.004],
    ["suspicious", 1.2, -1, "lean_in", -4, 2, 0.4, 0, 1.0, -0.006],
    ["grim", 0.9, -2, undefined, 0, 4, 0.15, 0, 0.8, -0.008],
    ["theatrical", 1.6, 3, "flare", -5, -4, 0, 0.25, 1.5, 0.014],
  ];

  it("covers exactly the 10 emotions", () => {
    expect(TABLE.map(([e]) => e).sort()).toStrictEqual([...EMOTIONS].sort());
    expect(Object.keys(EMOTION_TABLE).sort()).toStrictEqual([...EMOTIONS].sort());
  });

  it.each(TABLE)("%s -> eyeGain %d, brow %d, gesture %s and the mood columns", (emotion, eyeGain, brow, gesture, headTilt, headPitch, squint, jawSet, glowGain, browLift) => {
    const drive = lookToEmotionDrive(emotion);
    const mood = { headTilt, headPitch, squint, jawSet, glowGain, browLift };
    expect(drive).toStrictEqual(gesture === undefined ? { eyeGain, brow, ...mood } : { eyeGain, brow, gesture, ...mood });
    expect("gesture" in drive).toBe(gesture !== undefined);
  });

  it("returns a fresh object each call", () => {
    for (const emotion of EMOTIONS) {
      const first = lookToEmotionDrive(emotion);
      first.eyeGain = 99;
      expect(lookToEmotionDrive(emotion).eyeGain).toBe(EMOTION_TABLE[emotion].eyeGain);
    }
  });
});

describe("resolveGesture (task 6: look.gesture wins, else the emotion's default)", () => {
  const PALETTE = { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" };
  const look = (emotion: Emotion, gesture?: Gesture): Look =>
    gesture === undefined ? { palette: PALETTE, hidden: [], emotion } : { palette: PALETTE, hidden: [], emotion, gesture };

  const TABLE: readonly [Emotion, Gesture | undefined, Gesture | undefined][] = [
    // No look.gesture: the emotion table's default, or none.
    ["neutral", undefined, undefined],
    ["amused", undefined, "tilt"],
    ["smug", undefined, "tilt"],
    ["irritated", undefined, "glare"],
    ["furious", undefined, "flare"],
    ["delighted", undefined, "nod"],
    ["bored", undefined, undefined],
    ["suspicious", undefined, "lean_in"],
    ["grim", undefined, undefined],
    ["theatrical", undefined, "flare"],
    // look.gesture set: it wins over the default, and over "no default".
    ["neutral", "recoil", "recoil"],
    ["furious", "nod", "nod"],
    ["delighted", "glare", "glare"],
    ["grim", "lean_in", "lean_in"],
    ["amused", "tilt", "tilt"],
  ];

  it.each(TABLE)("%s with look.gesture %s -> %s", (emotion, gesture, expected) => {
    expect(resolveGesture(deepFreeze(look(emotion, gesture)))).toBe(expected);
  });

  it("is look.gesture when set, otherwise lookToEmotionDrive(emotion).gesture (property)", () => {
    fc.assert(
      fc.property(
        fc.record(
          { palette: arbPalette, hidden: fc.array(arbLayerName, { maxLength: 3 }), emotion: fc.constantFrom(...EMOTIONS), gesture: fc.constantFrom(...GESTURES) },
          { requiredKeys: ["palette", "hidden", "emotion"] },
        ),
        (arbLook: Look) => {
          const expected = "gesture" in arbLook ? arbLook.gesture : lookToEmotionDrive(arbLook.emotion).gesture;
          expect(resolveGesture(deepFreeze(clone(arbLook)))).toBe(expected);
        },
      ),
    );
  });
});

describe("public surface", () => {
  it("@sr/rig re-exports look.ts", () => {
    expect(surface.defaultLook).toBe(defaultLook);
    expect(surface.applyLook).toBe(applyLook);
    expect(surface.lookToEmotionDrive).toBe(lookToEmotionDrive);
    expect(surface.resolveGesture).toBe(resolveGesture);
    expect(surface.EMOTION_TABLE).toBe(EMOTION_TABLE);
  });
});
