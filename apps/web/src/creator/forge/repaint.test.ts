// forge-creator S2, repaint one face: the accept rule (faces.ts withRepaint, repaint.ts
// acceptRepaint). Property: after Accept the family's patches are exactly the candidate's, every
// other family's patch and every base layer field is byte-identical, look/voice/sheet/source stay,
// and the assets gain only the candidate's files. A candidate that did not pass, or names a file
// the rig already names or a layer it lacks, is refused. The repaint window.
import type { RepaintCandidate } from "@sr/forge/wire";
import { EXPRESSION_FAMILIES, defaultLook, type ExpressionFamily, type Layer, type LayerPatch, type Rig } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rigFiles } from "../library/assets";
import type { CharacterRecord } from "../library/libraryStore";
import { testRig } from "../testFixtures";
import { onlyFamilyChanged, withRepaint } from "./faces";
import { acceptRepaint, candidateFiles, repaintWindow } from "./repaint";

const FACE_LAYERS = ["head", "jaw", "eye_l", "eye_r"] as const;
const family = fc.constantFrom(...EXPRESSION_FAMILIES);
const patchOf = (layer: string, tag: string): LayerPatch => ({ file: `${layer}.${tag}.png`, bbox: [20, 10, 8, 8], mode: "over" });

/** testRig with random patches per face layer (the forge's names). */
const rigArb: fc.Arbitrary<Rig> = fc.array(fc.subarray([...EXPRESSION_FAMILIES]), { minLength: FACE_LAYERS.length, maxLength: FACE_LAYERS.length }).map((sets) => {
  const rig = testRig();
  return {
    ...rig,
    layers: rig.layers.map((l): Layer => {
      const i = (FACE_LAYERS as readonly string[]).indexOf(l.name);
      const fams = sets[i] ?? [];
      return fams.length === 0 ? l : { ...l, variants: Object.fromEntries(fams.map((f) => [f, patchOf(l.name, f)])) };
    }),
  };
});
const layersArb = fc.subarray([...FACE_LAYERS], { minLength: 1 });

function recordOf(rig: Rig): CharacterRecord {
  const assets: Record<string, Blob> = {};
  for (const f of rigFiles(rig)) assets[f] = new Blob([f]);
  return {
    id: rig.id,
    rig,
    assets,
    look: defaultLook(rig),
    voice: "crypt",
    createdAt: "2026-11-08T00:00:00.000Z",
    sheet: { archetype: "Night watch", hook: "Keeps the candle lit.", lines: [] },
    faceGate: { joy: { reason: "iris" }, anger: { reason: "band" } },
    source: { jobId: "a".repeat(32), expiresAt: 9e12, eyes: "carved holes" },
  };
}

function candidateOf(f: ExpressionFamily, layers: readonly string[], ok = true): RepaintCandidate {
  const patches = Object.fromEntries(layers.map((l) => [l, patchOf(l, `${f}_r1`)]));
  const assets = Object.fromEntries(layers.map((l) => [`${l}.${f}_r1.png`, `data:image/png;base64,AAAA`]));
  return ok ? { family: f, ok, plane: "live", patch: { layers: patches, assets }, left: { family: 1, job: 3 } } : { family: f, ok, plane: "live", gate: { reason: "iris" }, left: { family: 1, job: 3 } };
}

const blobsFor = (c: RepaintCandidate): Record<string, Blob> => Object.fromEntries(candidateFiles(c).map((f) => [f, new Blob([`new ${f}`])]));
const others = (layer: Layer, f: ExpressionFamily): string => JSON.stringify(Object.entries(layer.variants ?? {}).filter(([k]) => k !== f));
const base = (layer: Layer): string => JSON.stringify({ ...layer, variants: undefined });

describe("withRepaint / acceptRepaint", () => {
  it("replaces exactly the family's face; every other family and every base layer stays byte-identical", () => {
    fc.assert(
      fc.property(rigArb, family, layersArb, (rig, f, layers) => {
        const record = recordOf(rig);
        const before = JSON.stringify(record.rig);
        const c = candidateOf(f, layers);
        const blobs = blobsFor(c);
        const next = acceptRepaint(record, c, blobs);
        if (next === undefined) throw new Error("refused a valid candidate");
        expect(JSON.stringify(record.rig)).toBe(before);
        expect(onlyFamilyChanged(record.rig, next.rig, f)).toBe(true);
        next.rig.layers.forEach((layer, i) => {
          const was = record.rig.layers[i] as Layer;
          expect(base(layer)).toBe(base(was));
          expect(others(layer, f)).toBe(others(was, f));
          expect(layer.variants?.[f]).toEqual(c.patch?.layers[layer.name]);
        });
        // Assets: the base files' Blobs are the same objects; the new files are the candidate's.
        for (const l of record.rig.layers) expect(next.assets[l.file]).toBe(record.assets[l.file]);
        for (const file of candidateFiles(c)) expect(next.assets[file]).toBe(blobs[file]);
        expect(Object.keys(next.assets).sort()).toEqual(rigFiles(next.rig).sort());
        expect([next.look, next.voice, next.sheet, next.source, next.createdAt, next.id]).toEqual([record.look, record.voice, record.sheet, record.source, record.createdAt, record.id]);
        expect(next.faceGate?.[f]).toBeUndefined();
        for (const g of EXPRESSION_FAMILIES) if (g !== f) expect(next.faceGate?.[g]).toEqual(record.faceGate?.[g]);
      }),
    );
  });

  it("refuses a candidate that did not pass, a recorded one, missing files, an unknown layer or a file the rig already names", () => {
    const rig = testRig();
    const record = recordOf({ ...rig, layers: rig.layers.map((l) => (l.name === "head" ? { ...l, variants: { joy: patchOf("head", "joy") } } : l)) });
    const good = candidateOf("joy", ["head"]);
    expect(acceptRepaint(record, good, blobsFor(good))).toBeDefined();
    expect(acceptRepaint(record, candidateOf("joy", ["head"], false), {})).toBeUndefined();
    expect(acceptRepaint(record, { ...good, plane: "replay" }, blobsFor(good))).toBeUndefined();
    expect(acceptRepaint(record, good, {})).toBeUndefined();
    const ghost = candidateOf("joy", ["wing"]);
    expect(acceptRepaint(record, ghost, blobsFor(ghost))).toBeUndefined();
    expect(withRepaint(record.rig, "joy", { head: patchOf("head", "joy") })).toBeUndefined();
    expect(withRepaint(record.rig, "joy", {})).toBeUndefined();
  });

  it("the repaint window: none without a source, open before its end, expired at it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 45 }), fc.integer({ min: 0, max: 2 ** 45 }), (expiresAt, now) => {
        expect(repaintWindow({ source: { jobId: "a".repeat(32), expiresAt } }, now)).toBe(now < expiresAt ? "open" : "expired");
        expect(repaintWindow({}, now)).toBe("none");
      }),
    );
  });
});
