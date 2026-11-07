// replayFaces.ts: the replay plane's simulated faces tail (forge-creator C1).
import fc from "fast-check";
import { EXPRESSION_FAMILIES, validateRig, type ExpressionFamily, type Layer, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { facesAt, facesOutcomes, hasFaces, REPLAY_FACE_HOLD_MS, REPLAY_FACES_HOLD_MS, rigWithFaces, withFacesStep, type ReplayHold } from "./replayFaces.js";

const STEPS: ReplayHold[] = [
  { status: "queued", holdMs: 1500 },
  { status: "portrait", holdMs: 1500 },
  { status: "segmenting", holdMs: 1500 },
  { status: "cutting", holdMs: 1500 },
  { status: "filling", holdMs: 1500 },
  { status: "done", holdMs: 0 },
];

function layer(name: string, z: number, families: readonly ExpressionFamily[]): Layer {
  const base: Layer = { name, kind: z === 1 ? "head" : "accessory", file: `${name}.png`, bbox: [0, 0, 8, 8], anchor: [4, 4], z };
  if (families.length === 0) return base;
  return { ...base, variants: Object.fromEntries(families.map((f) => [f, { file: `${name}.${f}.png`, bbox: [0, 0, 4, 4] as [number, number, number, number], mode: "over" as const }])) };
}

const rigArb: fc.Arbitrary<Rig> = fc.array(fc.subarray([...EXPRESSION_FAMILIES]), { minLength: 1, maxLength: 4 }).map((perLayer) => ({
  version: 1,
  id: "r",
  name: "R",
  width: 8,
  height: 8,
  source: "forge",
  palette: { glow: "#ffffff", eye: "#28dcc8", rim: "#ffffff", mouth: "#000000" },
  layers: perLayer.map((families, i) => layer(`l${i}`, i + 1, families)),
}));

const patches = (rig: Rig): string[] => rig.layers.flatMap((l) => Object.entries(l.variants ?? {}).map(([f, p]) => `${l.name}:${f}:${p.file}`)).sort();

describe("the replay faces tail", () => {
  it("adds one expressing hold before done only for a rig with faces", () => {
    const faced = rigWithFaces({ ...(fc.sample(rigArb, 1)[0] as Rig), layers: [layer("head", 1, ["joy"])] }, 6);
    expect(withFacesStep(STEPS, faced).map((s) => s.status)).toEqual(["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done"]);
    expect(withFacesStep(STEPS, faced).find((s) => s.status === "expressing")?.holdMs).toBe(REPLAY_FACES_HOLD_MS);
    expect(withFacesStep(STEPS, rigWithFaces(faced, 0))).toEqual(STEPS);
    expect(withFacesStep(withFacesStep(STEPS, faced), faced)).toEqual(withFacesStep(STEPS, faced));
  });

  it("families arrive one per hold from the start of expressing", () => {
    const steps = withFacesStep(STEPS, { ...(fc.sample(rigArb, 1)[0] as Rig), layers: [layer("head", 1, ["joy"])] });
    expect(facesAt(steps, 0)).toBe(0);
    expect(facesAt(steps, 7499)).toBe(0);
    expect(facesAt(steps, 7500 + REPLAY_FACE_HOLD_MS)).toBe(1);
    expect(facesAt(steps, 7500 + REPLAY_FACES_HOLD_MS)).toBe(6);
    expect(facesAt(STEPS, 0)).toBe(6);
  });

  it("each step only adds patches, keeps the layers, ends at the recorded rig, and stays a valid rig (property)", () => {
    fc.assert(
      fc.property(rigArb, (rig) => {
        let prev = rigWithFaces(rig, 0);
        expect(hasFaces(prev)).toBe(false);
        for (let n = 1; n <= EXPRESSION_FAMILIES.length; n += 1) {
          const next = rigWithFaces(rig, n);
          expect(validateRig(next).ok).toBe(true);
          expect(next.layers.map((l) => [l.name, l.file])).toEqual(rig.layers.map((l) => [l.name, l.file]));
          expect(patches(next)).toEqual(expect.arrayContaining(patches(prev)));
          const outcomes = facesOutcomes(rig, n);
          expect(Object.keys(outcomes)).toEqual(EXPRESSION_FAMILIES.slice(0, n));
          prev = next;
        }
        expect(prev).toEqual(rig);
      }),
    );
  });
});
