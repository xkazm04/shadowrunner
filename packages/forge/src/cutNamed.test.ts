// cast-forge task 2.1 (design.md "Testing strategy"): v2 cut cores are disjoint for arbitrary named
// part sets, and assembled v2 rigs always pass validateRig. No network.
import fc from "fast-check";
import { validateRig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { assembleRig } from "./assemble.js";
import { compositeRig } from "./composite.js";
import { type NamedCutPart, cutNamed, liftedNamed, parallaxBacking, plateNamed } from "./cutNamed.js";
import { dilateMask, rasterizeMask } from "./mask.js";
import { fallbackFill, composePlate } from "./plate.js";
import { cutOrderNamed, isLifted } from "./named.js";
import { PART_ROLES, toCanvas } from "./parts.js";
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
  it("property: cores are disjoint (on a plate, a lifted core may overlap a plate part's, and a plate part may back the plate part in front of it), in cut order", () => {
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
            if (filled && pa !== undefined && pb !== undefined && (isLifted(pa) !== isLifted(pb) || (!isLifted(pa) && !isLifted(pb)))) return;
            const other = cores[i + 1 + k] ?? new Set<number>();
            for (const px of cores[i] ?? []) expect(other.has(px), `${a.name} and ${b.name} share an opaque pixel`).toBe(false);
          });
        });
      }),
      { numRuns: 60 },
    );
  });

  it("property: on a plate, a plate part overlaps the plate part in front of it only within parallaxBacking px of its own polygon", () => {
    const backing = parallaxBacking(SIZE, SIZE);
    fc.assert(
      fc.property(arbPoly, arbPoly, arbImage, (headPoly, torsoPoly, portrait) => {
        const parts: NamedPart[] = [
          { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: headPoly },
          { name: "body", role: "torso", box_2d: [0, 0, 1000, 1000], poly: torsoPoly },
        ];
        const lifted = liftedNamed(parts, SIZE, SIZE);
        const result = cutNamed(portrait, parts, { plate: composePlate(portrait, fallbackFill(portrait, lifted), lifted) });
        const face = result.layers.find((l) => l.name === "face");
        const body = result.layers.find((l) => l.name === "body");
        if (face === undefined || body === undefined) return;
        const near = dilateMask(rasterizeMask(toCanvas(torsoPoly, SIZE, SIZE), SIZE, SIZE, 0), backing).data;
        const bodyCore = coreOf(body);
        for (const px of coreOf(face)) if (bodyCore.has(px)) expect(near[px], `overlap at ${px} is past the backing`).toBe(255);
      }),
      { numRuns: 80 },
    );
  });

  it("on a plate, the torso is opaque under the head for parallaxBacking px above their seam (a turned head shows torso, not a gap)", () => {
    const size = 400;
    const backing = parallaxBacking(size, size);
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[100, 250], [100, 750], [500, 750], [500, 250]] },
      { name: "body", role: "torso", box_2d: [0, 0, 1000, 1000], poly: [[500, 100], [500, 900], [1000, 900], [1000, 100]] },
    ];
    const portrait: Rgba = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
    for (let i = 3; i < portrait.data.length; i += 4) portrait.data[i] = 255;
    const lifted = liftedNamed(parts, size, size);
    const body = cutNamed(portrait, parts, { plate: composePlate(portrait, fallbackFill(portrait, lifted), lifted) }).layers.find((l) => l.name === "body");
    expect(backing).toBeGreaterThanOrEqual(4);
    expect(body).toBeDefined();
    if (body === undefined) return;
    const [bx, by, bw] = body.bbox;
    const alpha = (x: number, y: number): number => body.image.data[((y - by) * bw + x - bx) * 4 + 3] ?? 0;
    for (let y = 200 - backing; y < 200; y++) expect(alpha(200, y), `torso alpha at (200, ${y})`).toBe(255);
  });

  it("task 7: the torso also reaches under a jaw at the head's foot (a bevor), which the head carries", () => {
    const size = 400;
    const backing = parallaxBacking(size, size);
    const parts: NamedPart[] = [
      { name: "bevor", role: "jaw", box_2d: [0, 0, 1000, 1000], poly: [[450, 300], [450, 700], [500, 700], [500, 300]] },
      { name: "helm", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[100, 250], [100, 750], [450, 750], [450, 250]] },
      { name: "body", role: "torso", box_2d: [0, 0, 1000, 1000], poly: [[500, 100], [500, 900], [1000, 900], [1000, 100]] },
    ];
    const portrait: Rgba = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
    for (let i = 3; i < portrait.data.length; i += 4) portrait.data[i] = 255;
    const lifted = liftedNamed(parts, size, size);
    const body = cutNamed(portrait, parts, { plate: composePlate(portrait, fallbackFill(portrait, lifted), lifted) }).layers.find((l) => l.name === "body");
    expect(body).toBeDefined();
    if (body === undefined) return;
    const [bx, by, bw] = body.bbox;
    const alpha = (x: number, y: number): number => (y < by ? 0 : (body.image.data[((y - by) * bw + x - bx) * 4 + 3] ?? 0));
    for (let y = 200 - backing; y < 200; y++) expect(alpha(200, y), `torso alpha under the bevor at (200, ${y})`).toBe(255);
  });

  it("plateNamed: a part with fill extend is painted from around it, the others from the edit", () => {
    const size = 64;
    const flat = (v: number): Rgba => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4).map((_, i) => (i % 4 === 3 ? 255 : v)) });
    const square = (y0: number, x0: number): [number, number][] => [[y0, x0], [y0, x0 + 150], [y0 + 150, x0 + 150], [y0 + 150, x0]];
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: square(0, 0).map(([y, x]) => [y * 6, x * 6]) },
      { name: "pupil", role: "eye", box_2d: [0, 0, 1000, 1000], poly: square(200, 200), fill: "extend" },
      { name: "gem", role: "accessory", box_2d: [0, 0, 1000, 1000], poly: square(650, 650) },
    ];
    const plate = plateNamed(flat(100), parts, flat(250));
    const at = (y: number, x: number): number => plate.data[(Math.round((y * size) / 1000) * size + Math.round((x * size) / 1000)) * 4] ?? 0;
    expect(at(275, 275)).toBe(100);
    expect(at(725, 725)).toBe(250);
  });

  it("task 8: a part floating on the ground is carried by no plate part; one on the head still is", () => {
    const size = 96;
    const box = (y0: number, x0: number, y1: number, x1: number): [number, number][] => [
      [y0, x0],
      [y0, x1],
      [y1, x1],
      [y1, x0],
    ];
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: box(100, 50, 900, 350) },
      { name: "glove", role: "float", box_2d: [0, 0, 1000, 1000], poly: box(200, 700, 600, 950), key: false },
      { name: "gem", role: "pulse", box_2d: [0, 0, 1000, 1000], poly: box(400, 150, 500, 250) },
    ];
    const portrait: Rgba = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
    const lifted = liftedNamed(parts, size, size);
    const plate = composePlate(portrait, fallbackFill(portrait, lifted), lifted);
    const face = cutNamed(portrait, parts, { plate }).layers.find((l) => l.name === "face");
    expect(face).toBeDefined();
    if (face === undefined) return;
    const [bx, , bw] = face.bbox;
    // The glove starts at x 67: the head layer stops short of it (its own edge at 34, plus its backing).
    expect(bx + bw).toBeLessThan(50);
    // The gem lies on the face: the face still carries the filled surface under it, opaque.
    const [, by] = face.bbox;
    expect(face.image.data[((43 - by) * bw + 19 - bx) * 4 + 3]).toBe(255);
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
