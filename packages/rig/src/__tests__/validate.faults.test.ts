// Fault seeding (design.md "Testing strategy"): start from an arbitrary valid rig, apply one
// mutation, and require exactly the error(s) that mutation causes. One property per error code.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { validateRig, type RigError } from "../validate.js";
import { arbLayerName, nth, PALETTE_KEYS, rigArb } from "./arb.js";

type Json = Record<string, unknown>;
interface Wire extends Json {
  palette: Json;
  layers: Json[];
}

function errorsOf(input: unknown): RigError[] {
  const result = validateRig(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

const summary = (errors: RigError[]) => errors.map((e) => ({ code: e.code, layer: e.layer }));

const withLayer = (rig: Rig, i: number, change: (layer: Layer) => Layer): Rig => ({
  ...rig,
  layers: rig.layers.map((l, j) => (j === i ? change(l) : l)),
});

/** Two distinct indices into a list of `n >= 2` items. */
const twoIndices = (n: number, a: number, b: number): [number, number] => {
  const i = a % n;
  const j = (i + 1 + (b % (n - 1))) % n;
  return [i, j];
};

describe("validateRig fault seeding: semantic codes", () => {
  it("bbox_out_of_bounds: a bbox pushed past any canvas edge", () => {
    const side = fc.constantFrom("left", "top", "right", "bottom");
    const by = fc.integer({ min: 1, max: 4000 }).map((q) => q / 4);
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), side, by, (rig, pick, edge, d) => {
        const i = pick % rig.layers.length;
        const broken = withLayer(rig, i, (l) => {
          const [x, y, w, h] = l.bbox;
          const bbox: Layer["bbox"] =
            edge === "left" ? [-d, y, w, h]
            : edge === "top" ? [x, -d, w, h]
            : edge === "right" ? [x, y, rig.width - x + d, h]
            : [x, y, w, rig.height - y + d];
          return { ...l, bbox };
        });
        expect(summary(errorsOf(broken))).toEqual([{ code: "bbox_out_of_bounds", layer: nth(rig.layers, i).name }]);
      }),
    );
  });

  it("duplicate_name: one layer renamed to another's name", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 2 }), fc.nat(), fc.nat(), (rig, a, b) => {
        const [i, j] = twoIndices(rig.layers.length, a, b);
        const name = nth(rig.layers, i).name;
        const errors = errorsOf(withLayer(rig, j, (l) => ({ ...l, name })));
        // The renamed layer's followers may now dangle or loop; nothing else may be reported.
        expect(errors.filter((e) => e.code !== "bad_follow")).toEqual([
          expect.objectContaining({ code: "duplicate_name", layer: name, path: `$.layers[${Math.max(i, j)}].name` }),
        ]);
      }),
    );
  });

  it("duplicate_z: one layer given another's z", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 2 }), fc.nat(), fc.nat(), (rig, a, b) => {
        const [i, j] = twoIndices(rig.layers.length, a, b);
        const z = nth(rig.layers, i).z;
        const errors = errorsOf(withLayer(rig, j, (l) => ({ ...l, z })));
        const later = nth(rig.layers, Math.max(i, j)).name;
        expect(summary(errors)).toEqual([{ code: "duplicate_z", layer: later }]);
      }),
    );
  });

  it("bad_follow: a follow naming a layer that does not exist", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), fc.oneof(arbLayerName, fc.string()), (rig, pick, missing) => {
        fc.pre(!rig.layers.some((l) => l.name === missing));
        const i = pick % rig.layers.length;
        const errors = errorsOf(withLayer(rig, i, (l) => ({ ...l, follow: missing })));
        expect(summary(errors)).toEqual([{ code: "bad_follow", layer: nth(rig.layers, i).name }]);
      }),
    );
  });

  it("bad_follow: follows that form a cycle (a self-follow included), one error per layer on it", () => {
    const ring = rigArb({ minLayers: 1 }).chain((rig) =>
      fc.tuple(fc.constant(rig), fc.shuffledSubarray(rig.layers.map((_, i) => i), { minLength: 1 })),
    );
    fc.assert(
      fc.property(ring, ([rig, members]) => {
        let broken = rig;
        members.forEach((at, k) => {
          const follow = nth(rig.layers, nth(members, k + 1)).name;
          broken = withLayer(broken, at, (l) => ({ ...l, follow }));
        });
        const errors = errorsOf(broken);
        expect(errors.every((e) => e.code === "bad_follow")).toBe(true);
        const onRing = members.map((at) => nth(rig.layers, at).name);
        expect(errors.map((e) => e.layer).sort()).toEqual([...onRing].sort());
      }),
    );
  });

  it("bad_color: a palette value that is not #rrggbb", () => {
    const notHex = fc
      .oneof(fc.string(), fc.constantFrom("#abc", "abcdef", "#abcdeg", "#abcdef0", " #abcdef", "#abcdef\n", "#ABCDEFF", "# abcdef"))
      .filter((s) => !/^#[0-9a-fA-F]{6}$/.test(s));
    fc.assert(
      fc.property(rigArb(), fc.constantFrom(...PALETTE_KEYS), notHex, (rig, key, value) => {
        const errors = errorsOf({ ...rig, palette: { ...rig.palette, [key]: value } });
        expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_color", `$.palette.${key}`]]);
      }),
    );
  });
});

const wireOf = (rig: Rig): Wire => JSON.parse(serializeRig(rig));
const set = (key: string, value: unknown) => (w: Json): Json => ({ ...w, [key]: value });
const drop = (key: string) => (w: Json): Json => Object.fromEntries(Object.entries(w).filter(([k]) => k !== key));
const sparseBbox = Object.assign(new Array<number>(4), { 0: 0, 2: 1, 3: 1 });

/** [JSON path, mutation of the decoded rig]. Each must yield exactly one bad_shape at that path. */
const RIG_FAULTS: [string, (w: Wire) => unknown][] = [
  ...[null, 3, "rig", [], true, undefined].map((v): [string, () => unknown] => ["$", () => v]),
  ...["version", "id", "name", "width", "height", "source", "palette", "layers"].map((k): [string, (w: Json) => Json] => [`$.${k}`, drop(k)]),
  ["$.version", set("version", 2)],
  ["$.version", set("version", "1")],
  ["$.id", set("id", 3)],
  ["$.name", set("name", null)],
  ["$.width", set("width", "10")],
  ["$.width", set("width", Infinity)],
  ["$.height", set("height", NaN)],
  ["$.source", set("source", "cloud")],
  ["$.fictional", set("fictional", false)],
  ["$.fictional", set("fictional", "true")],
  ["$.fictional", set("fictional", null)],
  ["$.palette", set("palette", [])],
  ["$.palette", set("palette", null)],
  ["$.palette.glow", (w) => ({ ...w, palette: { ...w.palette, glow: 0 } })],
  ["$.palette.mouth", (w) => ({ ...w, palette: drop("mouth")(w.palette) })],
  ["$.layers", set("layers", {})],
  ["$.layers", set("layers", "head")],
];

/** [path below `$.layers[i]`, mutation of that layer, does the error still name the layer?]. */
const LAYER_FAULTS: [string, (l: Json) => unknown, boolean][] = [
  ["", () => null, false],
  ["", () => [], false],
  ["", () => "head", false],
  ...["z", "kind", "file", "bbox", "anchor"].map((k): [string, (l: Json) => Json, boolean] => [`.${k}`, drop(k), true]),
  [".name", drop("name"), false],
  [".name", set("name", 3), false],
  [".name", set("name", "Head"), false],
  [".name", set("name", ""), false],
  [".name", set("name", "a-b"), false],
  [".z", set("z", 1.5), true],
  [".z", set("z", "1"), true],
  [".kind", set("kind", "hat"), true],
  [".kind", set("kind", "HEAD"), true],
  [".file", set("file", 3), true],
  [".bbox", set("bbox", [1, 2, 3]), true],
  [".bbox", set("bbox", [0, 0, 1, "1"]), true],
  [".bbox", set("bbox", [NaN, 0, 1, 1]), true],
  [".bbox", set("bbox", [0, Infinity, 1, 1]), true],
  [".bbox", set("bbox", sparseBbox), true],
  [".bbox", set("bbox", "0,0,1,1"), true],
  [".bbox[2]", set("bbox", [0, 0, 0, 1]), true],
  [".bbox[2]", set("bbox", [0, 0, -1, 1]), true],
  [".bbox[3]", set("bbox", [0, 0, 1, 0]), true],
  [".anchor", set("anchor", [1]), true],
  [".anchor", set("anchor", [1, 2, 3]), true],
  [".anchor", set("anchor", ["1", 2]), true],
  [".anchor", set("anchor", { x: 1, y: 2 }), true],
  [".follow", set("follow", 3), true],
  [".follow", set("follow", null), true],
  [".depth", set("depth", -0.1), true],
  [".depth", set("depth", 1.0001), true],
  [".depth", set("depth", "0.5"), true],
  [".depth", set("depth", NaN), true],
  [".visible", set("visible", true), true],
  [".visible", set("visible", null), true],
  [".visible", set("visible", "false"), true],
];

describe("validateRig fault seeding: bad_shape", () => {
  it("rejects each rig-level shape fault with one bad_shape naming its JSON path", () => {
    for (const [path, mutate] of RIG_FAULTS) {
      fc.assert(
        fc.property(rigArb(), (rig) => {
          const errors = errorsOf(mutate(wireOf(rig)));
          expect(errors.map((e) => [e.code, e.path]), `${path} ${mutate.toString()}`).toEqual([["bad_shape", path]]);
        }),
        { numRuns: 20 },
      );
    }
  });

  it("rejects each layer-level shape fault with one bad_shape naming its JSON path and layer", () => {
    for (const [suffix, mutate, named] of LAYER_FAULTS) {
      fc.assert(
        fc.property(rigArb({ minLayers: 1 }), fc.nat(), (rig, pick) => {
          const i = pick % rig.layers.length;
          const wire = wireOf(rig);
          const input = { ...wire, layers: wire.layers.map((l, j) => (j === i ? mutate(l) : l)) };
          const errors = errorsOf(input);
          const label = `${suffix} ${mutate.toString()}`;
          expect(errors.map((e) => [e.code, e.path]), label).toEqual([["bad_shape", `$.layers[${i}]${suffix}`]]);
          if (named) expect(errors[0]?.layer, label).toBe(nth(rig.layers, i).name);
        }),
        { numRuns: 20 },
      );
    }
  });
});
