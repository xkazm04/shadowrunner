// retire-a-face: `expression.faces` on the face profile retires a family's painted face to
// procedural motion. The profile reads, writes and resolves it (face.ts); poseLayers never lists a
// retired family and leaves every other family's weight exactly as it was; Sir Vacant's recorded rig
// loses its showman face with no asset change.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXPRESSION_FAMILIES } from "../control.js";
import { readFace, resolveFace, withFaceValue, withRetired } from "../face.js";
import { EMOTION_TABLE } from "../look.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import { readLook } from "../readLook.js";
import type { Emotion, Layer, LayerPatch, Look, Rig } from "../types.js";
import { rigArb } from "./arb.js";
import { replayRigs } from "./replayJobs.js";

const EMOTIONS = Object.keys(EMOTION_TABLE) as Emotion[];
const REST: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const PATCH: LayerPatch = { file: "p.png", bbox: [0, 0, 1, 1], mode: "over" };

const arbFamilies = fc.subarray([...EXPRESSION_FAMILIES]);

/** A rig whose layers carry variants for random families (some of them narrowed). */
const arbFacedRig: fc.Arbitrary<Rig> = rigArb({ minLayers: 1, maxLayers: 6 }).chain((rig) =>
  fc.array(fc.tuple(arbFamilies, fc.boolean()), { minLength: rig.layers.length, maxLength: rig.layers.length }).map((picks) => ({
    ...rig,
    layers: rig.layers.map((layer, i): Layer => {
      const [families, narrowed] = picks[i] ?? [[], false];
      if (families.length === 0) return layer;
      return { ...layer, variants: Object.fromEntries(families.map((f) => [f, narrowed ? { ...PATCH, narrowed: true } : PATCH])) };
    }),
  })),
);

const facesBy = (poses: LayerPose[]): Map<string, LayerPose["faces"]> => new Map(poses.map((p) => [p.name, p.faces]));

describe("poseLayers with retired faces (property)", () => {
  it("never lists a retired family; every other family keeps exactly its weight", () => {
    fc.assert(
      fc.property(
        arbFacedRig,
        arbFamilies,
        fc.constantFrom(...EMOTIONS),
        fc.option(fc.record({ from: fc.constantFrom(...EMOTIONS), mix: fc.double({ min: 0, max: 1, noNaN: true }) }), { nil: undefined }),
        fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
        (rig, families, emotion, mood, strength) => {
          const face = strength === undefined ? undefined : withFaceValue(undefined, "expression.strength", strength);
          const look: Look = { palette: rig.palette, hidden: [], emotion, ...(face === undefined ? {} : { face }) };
          const retiredFace = families.reduce((acc, family) => withRetired(acc, family, true), face ?? {});
          const retiredLook: Look = { ...look, face: retiredFace };
          const drive: Drive = { ...REST, ...(mood === undefined ? {} : { mood }) };
          const before = facesBy(poseLayers(rig, look, drive));
          const after = facesBy(poseLayers(rig, retiredLook, drive));
          const retired = new Set(families);
          for (const [name, faces] of before) {
            const kept = (faces ?? []).filter((f) => !retired.has(f.family));
            expect(after.get(name) ?? [], name).toEqual(kept);
          }
        },
      ),
    );
  });
});

describe("Sir Vacant's recorded rig", () => {
  const sir = replayRigs().find((j) => j.slug === "sir-vacant")?.rig;
  if (sir === undefined) throw new Error("no sir-vacant job");
  const theatrical: Look = { palette: sir.palette, hidden: [], emotion: "theatrical" };
  const showman = (look: Look, drive: Drive = REST): string[] => poseLayers(sir, look, drive).filter((p) => p.faces?.some((f) => f.family === "showman")).map((p) => p.name);

  it("paints showman on his slits until the look retires it; the other families keep their faces", () => {
    expect(showman(theatrical)).toEqual(["slit_l", "slit_r"]);
    const retired: Look = { ...theatrical, face: { expression: { faces: { showman: "procedural" } } } };
    expect(showman(retired)).toEqual([]);
    expect(showman(retired, { ...REST, mood: { from: "furious", mix: 0.5 } })).toEqual([]);
    const furious = (look: Look): unknown => poseLayers(sir, { ...look, emotion: "furious" }, REST).map((p) => p.faces);
    expect(furious(retired)).toEqual(furious(theatrical));
  });
});

describe("the profile's expression.faces", () => {
  it("readFace keeps known families set to procedural; drops and reports bad values; ignores unknown families", () => {
    const { face, problems } = readFace({ expression: { strength: 0.5, faces: { showman: "procedural", joy: "painted", ghost: "procedural" } } }, "$.face");
    expect(face).toEqual({ expression: { strength: 0.5, faces: { showman: "procedural" } } });
    expect(problems.map((p) => p.path)).toEqual(["$.face.expression.faces.joy"]);
    expect(readFace({ expression: { faces: [] } }, "$.face")).toEqual({ problems: [expect.objectContaining({ path: "$.face.expression.faces" })] });
    expect(readFace({ expression: { faces: { joy: 1 } } }, "$.face").face).toBeUndefined();
  });

  it("withRetired retires and restores in family order, leaving nothing behind when empty", () => {
    let face = withRetired(undefined, "smug", true);
    face = withRetired(face, "joy", true);
    expect(JSON.stringify(face)).toBe('{"expression":{"faces":{"joy":"procedural","smug":"procedural"}}}');
    face = withRetired(withRetired(face, "joy", false), "smug", false);
    expect(face).toEqual({});
    const tuned = withRetired({ expression: { strength: 0.4 }, gaze: { range: 0.2 } }, "anger", true);
    expect(withRetired(tuned, "anger", false)).toEqual({ expression: { strength: 0.4 }, gaze: { range: 0.2 } });
    expect(withFaceValue(tuned, "expression.strength", undefined)).toEqual({ expression: { faces: { anger: "procedural" } }, gaze: { range: 0.2 } });
  });

  it("resolveFace unions Rig.face's and Look.face's retirements; none resolves to {}", () => {
    expect(resolveFace(undefined).expression.faces).toEqual({});
    const r = resolveFace({ face: { expression: { faces: { gloom: "procedural" } } } }, { face: { expression: { faces: { joy: "procedural" } } } });
    expect(r.expression.faces).toEqual({ gloom: "procedural", joy: "procedural" });
  });

  it("readLook keeps a retirement and drops a bad one without dropping the look", () => {
    const base = { palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" }, hidden: [], emotion: "neutral" };
    expect(readLook({ ...base, face: { expression: { faces: { showman: "procedural" } } } })?.face).toEqual({ expression: { faces: { showman: "procedural" } } });
    const bad = readLook({ ...base, face: { expression: { faces: { showman: "yes" } } } });
    expect(bad).toEqual(base);
  });
});
