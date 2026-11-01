import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { arbRig, nth, rigArb } from "./arb.js";

const RIG_KEYS = ["version", "id", "name", "width", "height", "source", "fictional", "palette", "layers"];
const PALETTE_KEYS = ["glow", "eye", "rim", "mouth"];
const LAYER_KEYS = ["name", "z", "kind", "file", "bbox", "anchor", "follow", "depth", "visible"];

/** JSON paths of every null in a decoded value. */
function nullPaths(value: unknown, path = "$"): string[] {
  if (value === null) return [path];
  if (Array.isArray(value)) return value.flatMap((item: unknown, i) => nullPaths(item, `${path}[${i}]`));
  if (typeof value === "object") return Object.entries(value).flatMap(([k, v]) => nullPaths(v, `${path}.${k}`));
  return [];
}

/** Same rig, with every absent optional field present as an explicit `undefined`. */
function withUndefined(rig: Rig): Rig {
  const layer = (l: Layer): Layer => ({ ...l, follow: l.follow, depth: l.depth, visible: l.visible });
  return { ...rig, fictional: rig.fictional, layers: rig.layers.map(layer) };
}

/** Same fields, inserted in reverse order (built by hand so the result stays typed). */
function reversedRig(rig: Rig): Rig {
  const { glow, eye, rim, mouth } = rig.palette;
  const layer = ({ name, z, kind, file, bbox, anchor, follow, depth, visible }: Layer): Layer => ({
    ...(visible === undefined ? {} : { visible }),
    ...(depth === undefined ? {} : { depth }),
    ...(follow === undefined ? {} : { follow }),
    anchor,
    bbox,
    file,
    kind,
    z,
    name,
  });
  return {
    layers: rig.layers.map(layer),
    palette: { mouth, rim, eye, glow },
    ...(rig.fictional === undefined ? {} : { fictional: rig.fictional }),
    source: rig.source,
    height: rig.height,
    width: rig.width,
    name: rig.name,
    id: rig.id,
    version: rig.version,
  };
}

/** True when `keys` is a subsequence of `order` (present keys in contract order, nothing else). */
function inOrder(keys: string[], order: string[]): boolean {
  let at = 0;
  for (const key of keys) {
    at = order.indexOf(key, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

describe("serializeRig", () => {
  it("never writes null, even when optional fields are explicitly undefined", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        expect(nullPaths(JSON.parse(serializeRig(rig)))).toEqual([]);
        expect(nullPaths(JSON.parse(serializeRig(withUndefined(rig))))).toEqual([]);
      }),
    );
  });

  it("drops undefined keys: explicit undefined serializes exactly like an absent field", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        expect(serializeRig(withUndefined(rig))).toBe(serializeRig(rig));
      }),
    );
  });

  it("writes keys in contract order regardless of the input's key order", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        const text = serializeRig(rig);
        expect(serializeRig(reversedRig(rig))).toBe(text);
        const wire: { palette: object; layers: object[] } = JSON.parse(text);
        expect(inOrder(Object.keys(wire), RIG_KEYS)).toBe(true);
        expect(Object.keys(wire.palette)).toEqual(PALETTE_KEYS);
        for (const layer of wire.layers) expect(inOrder(Object.keys(layer), LAYER_KEYS)).toBe(true);
      }),
    );
  });

  it("keeps the layer order and every contract field", () => {
    fc.assert(
      fc.property(arbRig, (rig) => {
        expect(JSON.parse(serializeRig(rig))).toEqual(rig);
      }),
    );
  });

  it("drops fields outside the contract", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), (rig) => {
        const extra = { ...rig, extra: 1, palette: { ...rig.palette, extra: 2 }, layers: rig.layers.map((l) => ({ ...l, extra: 3 })) };
        expect(serializeRig(extra)).toBe(serializeRig(rig));
      }),
    );
  });

  it("throws instead of writing null for a non-finite number", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), fc.constantFrom(NaN, Infinity, -Infinity), (rig, pick, bad) => {
        const target = nth(rig.layers, pick);
        const broken: Rig = { ...rig, layers: rig.layers.map((l) => (l === target ? { ...l, depth: bad } : l)) };
        expect(() => serializeRig(broken)).toThrow(RangeError);
        expect(() => serializeRig({ ...rig, width: bad })).toThrow(RangeError);
      }),
    );
  });
});
