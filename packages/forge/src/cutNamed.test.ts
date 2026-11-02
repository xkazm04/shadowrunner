// cast-forge task 2.1 (design.md "Testing strategy"): v2 cut cores are disjoint for arbitrary named
// part sets, and assembled v2 rigs always pass validateRig. No network.
import fc from "fast-check";
import { validateRig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { assembleRig } from "./assemble.js";
import { compositeRig } from "./composite.js";
import { type NamedCutPart, cutNamed, liftedNamed } from "./cutNamed.js";
import { fallbackFill, composePlate } from "./plate.js";
import { cutOrderNamed, isLifted } from "./named.js";
import { PART_ROLES } from "./parts.js";
import type { NamedPart, PartRole, Rgba } from "./types.js";

const SIZE = 32;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 10 });
const arbMotion = fc.option(
  fc.record({ float: fc.record({ amp: fc.tuple(fc.double({ min: 0, max: 51, noNaN: true }), fc.double({ min: 0, max: 51, noNaN: true })), freq: fc.double({ min: 0.02, max: 2, noNaN: true }) }) }),
  { nil: undefined },
);

/** A head plus 0..8 other parts with unique names, random roles, and follows that point backwards (no cycles). */
const arbNamed: fc.Arbitrary<NamedPart[]> = fc
  .array(fc.tuple(fc.constantFrom(...PART_ROLES), arbPoly, fc.option(fc.nat(), { nil: undefined }), arbMotion, fc.option(fc.boolean(), { nil: undefined })), { maxLength: 8 })
  .chain((others) =>
    arbPoly.map((headPoly) => {
      const parts: NamedPart[] = [{ name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: headPoly }];
      others.forEach(([role, poly, follow, motion, key], i) => {
        const part: NamedPart = { name: `p${i}`, role: role as PartRole, box_2d: [0, 0, 1000, 1000], poly };
        if (follow !== undefined) part.follow = parts[follow % parts.length]?.name ?? "face";
        if (motion !== undefined) part.motion = motion;
        if (key !== undefined) part.key = key;
        parts.push(part);
      });
      return parts;
    }),
  )
  .chain((parts) => fc.shuffledSubarray(parts, { minLength: parts.length }));

const arbImage: fc.Arbitrary<Rgba> = fc.uint8Array({ minLength: SIZE * SIZE * 3, maxLength: SIZE * SIZE * 3 }).map((bytes) => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([bytes[i * 3] ?? 0, bytes[i * 3 + 1] ?? 0, bytes[i * 3 + 2] ?? 0, 255], i * 4);
  return { width: SIZE, height: SIZE, data };
});

/** Canvas indices where the layer is fully opaque. */
function coreOf(layer: NamedCutPart): Set<number> {
  const out = new Set<number>();
  const [bx, by, bw] = layer.bbox;
  for (let i = 0; i < layer.image.width * layer.image.height; i++) {
    if (layer.image.data[i * 4 + 3] !== 255) continue;
    out.add((by + Math.floor(i / bw)) * SIZE + bx + (i % bw));
  }
  return out;
}

describe("cutNamed", () => {
  it("property: cores are disjoint (on a plate, only a lifted core may overlap a plate part's), in cut order", () => {
    fc.assert(
      fc.property(arbNamed, arbImage, fc.boolean(), (parts, portrait, filled) => {
        const plate = filled ? composePlate(portrait, fallbackFill(portrait, liftedNamed(parts, SIZE, SIZE)), liftedNamed(parts, SIZE, SIZE)) : undefined;
        const result = cutNamed(portrait, parts, plate === undefined ? {} : { plate });
        const order = cutOrderNamed(parts).map((p) => p.name);
        expect([...result.layers.map((l) => l.name), ...result.empty].sort()).toEqual(parts.map((p) => p.name).sort());
        const at = result.layers.map((l) => order.indexOf(l.name));
        expect(at).toEqual([...at].sort((a, b) => a - b));
        const cores = result.layers.map(coreOf);
        const byName = new Map(parts.map((p) => [p.name, p]));
        result.layers.forEach((a, i) => {
          result.layers.slice(i + 1).forEach((b, k) => {
            const pa = byName.get(a.name);
            const pb = byName.get(b.name);
            if (filled && pa !== undefined && pb !== undefined && isLifted(pa) !== isLifted(pb)) return;
            const other = cores[i + 1 + k] ?? new Set<number>();
            for (const px of cores[i] ?? []) expect(other.has(px), `${a.name} and ${b.name} share an opaque pixel`).toBe(false);
          });
        });
      }),
      { numRuns: 60 },
    );
  });

  it("lifts every non-plate part: on a plate, a lifted layer is opaque over its whole polygon unless a part in front took it", () => {
    const square: [number, number][] = [
      [250, 250],
      [250, 750],
      [750, 750],
      [750, 250],
    ];
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: square },
      { name: "gem", role: "pulse", box_2d: [0, 0, 1000, 1000], poly: square, follow: "face" },
    ];
    const portrait: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(255) };
    const lifted = liftedNamed(parts, SIZE, SIZE);
    const plate = composePlate(portrait, fallbackFill(portrait, lifted), lifted);
    const gem = cutNamed(portrait, parts, { plate }).layers.find((l) => l.name === "gem");
    expect(gem).toBeDefined();
    if (gem === undefined) return;
    const core = coreOf(gem);
    for (let i = 0; i < lifted.data.length; i++) if (lifted.data[i] === 255) expect(core.has(i)).toBe(true);
  });
});

describe("assembleRig over named parts", () => {
  it("property: the rig always passes validateRig; follows name layers; float and pulse layers move", () => {
    fc.assert(
      fc.property(arbNamed, arbImage, fc.infiniteStream(fc.boolean()), (parts, portrait, keep) => {
        const cut = cutNamed(portrait, parts);
        const layers = cut.layers.filter(() => keep.next().value === true);
        const result = assembleRig(parts, layers, { id: "named", name: "Named", portrait });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { rig, files } = result.value;
        expect(validateRig(rig).ok).toBe(true);
        const names = new Set(rig.layers.map((l) => l.name));
        for (const layer of rig.layers) {
          expect(files[layer.file]).toBeDefined();
          if (layer.follow !== undefined) expect(names.has(layer.follow)).toBe(true);
          const role = parts.find((p) => p.name === layer.name)?.role;
          if (role === "float") expect(layer.motion?.float).toBeDefined();
          if (role === "pulse" && parts.find((p) => p.name === layer.name)?.motion === undefined) expect(layer.motion?.pulse).toBeDefined();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("a part with an explicit follow takes its target's depth; motion is scaled to the canvas", () => {
    const square: [number, number][] = [
      [100, 100],
      [100, 900],
      [900, 900],
      [900, 100],
    ];
    const small: [number, number][] = [
      [400, 400],
      [400, 600],
      [600, 600],
      [600, 400],
    ];
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[0, 0], [0, 1000], [100, 500]] },
      { name: "robe", role: "torso", box_2d: [0, 0, 1000, 1000], poly: square },
      { name: "heart", role: "pulse", box_2d: [0, 0, 1000, 1000], poly: small, follow: "robe", motion: { float: { amp: [32, 0], freq: 1 } } },
    ];
    const portrait: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(180) };
    const result = assembleRig(parts, cutNamed(portrait, parts).layers, { id: "d", name: "D", portrait });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heart = result.value.rig.layers.find((l) => l.name === "heart");
    const robe = result.value.rig.layers.find((l) => l.name === "robe");
    expect(heart?.follow).toBe("robe");
    expect(heart?.depth).toBe(robe?.depth);
    expect(heart?.kind).toBe("accessory");
    expect(heart?.motion?.float?.amp).toEqual([1, 0]);
  });
});

describe("compositeRig gains (the review sheet's pulse)", () => {
  it("multiplies a layer's colour by its gain, clamped, and leaves other layers alone", () => {
    const px = (v: number): Rgba => ({ width: 1, height: 1, data: new Uint8ClampedArray([v, v, v, 255]) });
    const rig = {
      width: 2,
      height: 1,
      layers: [
        { name: "a", z: 1, kind: "static" as const, file: "a.png", bbox: [0, 0, 1, 1] as [number, number, number, number], anchor: [0, 0] as [number, number] },
        { name: "b", z: 2, kind: "accessory" as const, file: "b.png", bbox: [1, 0, 1, 1] as [number, number, number, number], anchor: [1, 0] as [number, number] },
      ],
    };
    const out = compositeRig(rig, { "a.png": px(100), "b.png": px(200) }, { gains: { b: 1.5, a: 1 } });
    expect([out.data[0], out.data[4]]).toEqual([100, 255]);
    expect(compositeRig(rig, { "a.png": px(100), "b.png": px(100) }, { gains: { b: 1.5 } }).data[4]).toBe(150);
  });
});
