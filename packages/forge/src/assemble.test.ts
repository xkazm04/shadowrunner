// forge-pipeline task 5: assembleRig (requirement 6). No network. The golden runs the committed
// Malakor portrait and the recorded m8 parts through fill (pure fallback), cut and assemble.
import fc from "fast-check";
import { DEFAULT_DEPTH, type Layer, validateRig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import m8 from "../test/fixtures/m8-parts.json";
import { BACKGROUND_LAYER, BACKGROUND_Z, HEAD_FOLLOWERS, assembleRig } from "./assemble.js";
import { CUT_ORDER, FILL_PARTS, cutAll } from "./cut.js";
import { blurExtend } from "./fill.js";
import { decodeImage } from "./image.js";
import { malakorPortrait, partsOf } from "./malakor.fixture.js";
import { type Mask, rasterizeMask } from "./mask.js";
import { PART_KIND, toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type Rgba } from "./types.js";

const SIZE = 48;
const arbPoly = fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: 3, maxLength: 12 });
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) =>
    fc.tuple(...["head" as const, ...others].map((name) => arbPoly.map((poly): Part => ({ name, box_2d: [0, 0, 1000, 1000], poly })))),
  )
  .chain((parts) => fc.shuffledSubarray(parts, { minLength: parts.length }));
const arbImage: fc.Arbitrary<Rgba> = fc
  .uint8Array({ minLength: SIZE * SIZE * 3, maxLength: SIZE * SIZE * 3 })
  .map((bytes) => {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) data.set([bytes[i * 3] ?? 0, bytes[i * 3 + 1] ?? 0, bytes[i * 3 + 2] ?? 0, 255], i * 4);
    return { width: SIZE, height: SIZE, data };
  });

function decoded(bytes: Uint8Array | undefined): Rgba {
  const result = decodeImage(bytes ?? new Uint8Array());
  if (!result.ok) throw new Error(result.errors.message);
  return result.value;
}

const layerOf = (layers: readonly Layer[], name: string): Layer | undefined => layers.find((l) => l.name === name);

describe("assembleRig", () => {
  it("property: the output always passes validateRig and follows the requirement 6 layout", () => {
    fc.assert(
      fc.property(
        arbParts,
        arbImage,
        fc.option(arbImage, { nil: undefined }),
        fc.infiniteStream(fc.boolean()),
        (parts, portrait, plate, keep) => {
          // Any subset of the cut layers, so a head lost in cutting is covered too.
          const cut = cutAll(portrait, parts, plate === undefined ? {} : { plate });
          const layers = cut.layers.filter(() => keep.next().value === true);
          const result = assembleRig(parts, layers, { id: "forged", name: "Forged", portrait, ...(plate === undefined ? {} : { plate }) });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const { rig, files, warnings } = result.value;
          expect(validateRig(rig).ok).toBe(true);
          expect(rig).toMatchObject({ version: 1, source: "forge", fictional: true, width: SIZE, height: SIZE, id: "forged" });

          const [background, ...rest] = rig.layers;
          expect(background).toEqual({
            name: BACKGROUND_LAYER,
            z: BACKGROUND_Z,
            kind: "static",
            file: "background.png",
            bbox: [0, 0, SIZE, SIZE],
            anchor: [SIZE / 2, SIZE / 2],
            depth: 0,
          });
          expect(rest.map((l) => l.name)).toEqual(
            [...layers].sort((a, b) => CUT_ORDER.indexOf(b.name) - CUT_ORDER.indexOf(a.name)).map((l) => l.name),
          );
          expect(rest.map((l) => l.z)).toEqual(rest.map((_, k) => BACKGROUND_Z + 1 + k));

          const hasHead = layers.some((l) => l.name === "head");
          for (const layer of rest) {
            const source = layers.find((l) => l.name === layer.name);
            const kind = PART_KIND[source?.name ?? "head"];
            expect(layer.kind).toBe(kind);
            expect(layer.depth).toBe(DEFAULT_DEPTH[kind]);
            expect(layer.bbox).toEqual(source?.bbox);
            expect(layer.follow).toBe(hasHead && HEAD_FOLLOWERS.includes(kind) ? "head" : undefined);
            expect(Number.isFinite(layer.anchor[0]) && Number.isFinite(layer.anchor[1])).toBe(true);
          }
          expect(Object.keys(files).sort()).toEqual(rig.layers.map((l) => l.file).sort());
          const followers = rest.some((l) => HEAD_FOLLOWERS.includes(l.kind));
          expect(warnings.some((w) => w.code === "no_head_layer")).toBe(!hasHead && followers);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("places anchors by requirement 6.2 and writes each layer's pixels to its file", () => {
    const rect = (name: Part["name"], x0: number, y0: number, x1: number, y1: number): Part => {
      const s = (v: number): number => Math.round((v * 1000) / 40);
      return { name, box_2d: [s(y0), s(x0), s(y1), s(x1)], poly: [[s(y0), s(x0)], [s(y0), s(x1)], [s(y1), s(x1)], [s(y1), s(x0)]] };
    };
    const parts = [rect("head", 8, 4, 32, 24), rect("jaw", 12, 24, 28, 32), rect("eye_l", 20, 10, 26, 14), rect("torso", 0, 30, 40, 40)];
    const data = new Uint8ClampedArray(40 * 40 * 4);
    for (let i = 0; i < 1600; i++) data.set([(i * 7) % 200 + 40, (i * 3) % 200 + 40, 90, 255], i * 4);
    const portrait = { width: 40, height: 40, data };
    const { layers } = cutAll(portrait, parts);
    const result = assembleRig(parts, layers, { id: "box", name: "Box", portrait });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { rig, files } = result.value;
    expect(layerOf(rig.layers, "jaw")?.anchor).toEqual([20, 24]); // top-centre: the hinge
    expect(layerOf(rig.layers, "head")?.anchor).toEqual([20, 24]); // bottom-centre
    expect(layerOf(rig.layers, "eye_l")?.anchor).toEqual([23, 12]); // centroid of the pixel centres
    expect(layerOf(rig.layers, "torso")?.anchor).toEqual([20, 35]); // bbox centre
    expect(rig.layers.map((l) => [l.name, l.follow])).toEqual([
      ["background", undefined],
      ["torso", undefined],
      ["head", undefined],
      ["jaw", "head"],
      ["eye_l", "head"],
    ]);
    for (const layer of layers) {
      const image = decoded(files[`${layer.name}.png`]);
      expect([image.width, image.height]).toEqual([layer.image.width, layer.image.height]);
      expect(image.data.join(",")).toBe(layer.image.data.join(","));
    }
  });

  it("draws the whole plate as the background (task 9) and surfaces palette_fallback", () => {
    const portrait: Rgba = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
    const plate: Rgba = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    for (let i = 0; i < 64 * 64; i++) plate.data.set([6, 5, 9, 255], i * 4);
    plate.data.set([200, 40, 90, 255], (30 * 64 + 31) * 4);
    const parts = partsOf([{ name: "head", box_2d: [200, 200, 800, 800], poly: [[200, 200], [200, 800], [800, 800], [800, 200]] }]);
    const result = assembleRig(parts, cutAll(portrait, parts, { plate }).layers, { id: "white", name: "White", portrait, plate });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const background = decoded(result.value.files["background.png"]);
    expect(Array.from(background.data.subarray(0, 4))).toEqual([6, 5, 9, 255]);
    expect(Array.from(background.data.subarray(-4))).toEqual([6, 5, 9, 255]);
    expect(background.data.join(",")).toBe(plate.data.join(","));
    expect(result.value.warnings.map((w) => w.code)).toEqual(["palette_fallback"]);
    expect(() => assembleRig(parts, [], { id: "x", name: "X", portrait, plate: { ...plate, width: 32 } })).toThrow(RangeError);
  });
});

describe("golden: Malakor portrait + m8 parts -> a valid rig (task 5)", () => {
  const portrait = malakorPortrait();
  const parts = partsOf(m8);
  const hole: Mask = { width: 1024, height: 1024, data: new Uint8ClampedArray(1024 * 1024) };
  for (const part of parts) {
    if (!FILL_PARTS.includes(part.name)) continue;
    rasterizeMask(toCanvas(part.poly, 1024, 1024), 1024, 1024, 0).data.forEach((a, i) => {
      if (a !== 0) hole.data[i] = 255;
    });
  }
  const plate = blurExtend(portrait, hole);
  const cut = cutAll(portrait, parts, { plate });
  const result = assembleRig(parts, cut.layers, { id: "malakor_forged", name: "Arch-Lich Malakor", portrait, plate });

  it("validates, with every part plus the background, and no warnings", () => {
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { rig, warnings } = result.value;
    expect(validateRig(rig).ok).toBe(true);
    expect(rig.layers.length).toBeGreaterThanOrEqual(8);
    expect(warnings).toEqual([]);
    const round = ([x, y]: [number, number]): [number, number] => [Math.round(x), Math.round(y)];
    expect({
      palette: rig.palette,
      layers: rig.layers.map((l) => ({ name: l.name, z: l.z, kind: l.kind, follow: l.follow, bbox: l.bbox, anchor: round(l.anchor) })),
    }).toMatchInlineSnapshot(`
      {
        "layers": [
          {
            "anchor": [
              512,
              512,
            ],
            "bbox": [
              0,
              0,
              1024,
              1024,
            ],
            "follow": undefined,
            "kind": "static",
            "name": "background",
            "z": 1,
          },
          {
            "anchor": [
              426,
              675,
            ],
            "bbox": [
              7,
              453,
              837,
              445,
            ],
            "follow": undefined,
            "kind": "body",
            "name": "torso",
            "z": 2,
          },
          {
            "anchor": [
              514,
              551,
            ],
            "bbox": [
              332,
              152,
              386,
              491,
            ],
            "follow": undefined,
            "kind": "head",
            "name": "head",
            "z": 3,
          },
          {
            "anchor": [
              512,
              454,
            ],
            "bbox": [
              367,
              445,
              290,
              186,
            ],
            "follow": "head",
            "kind": "jaw",
            "name": "jaw",
            "z": 4,
          },
          {
            "anchor": [
              519,
              164,
            ],
            "bbox": [
              252,
              7,
              531,
              315,
            ],
            "follow": "head",
            "kind": "crown",
            "name": "crown",
            "z": 5,
          },
          {
            "anchor": [
              632,
              348,
            ],
            "bbox": [
              556,
              273,
              150,
              151,
            ],
            "follow": "head",
            "kind": "accessory",
            "name": "monocle",
            "z": 6,
          },
          {
            "anchor": [
              411,
              340,
            ],
            "bbox": [
              347,
              283,
              132,
              113,
            ],
            "follow": "head",
            "kind": "eye",
            "name": "eye_r",
            "z": 7,
          },
          {
            "anchor": [
              622,
              343,
            ],
            "bbox": [
              561,
              287,
              120,
              113,
            ],
            "follow": "head",
            "kind": "eye",
            "name": "eye_l",
            "z": 8,
          },
        ],
        "palette": {
          "eye": "#a8ebd0",
          "glow": "#5fc89e",
          "mouth": "#13261f",
          "rim": "#a8ebd0",
        },
      }
    `);
  });
});
