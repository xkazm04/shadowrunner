// cast-forge task 4: an attached part turns about where it meets its follow target (a lure stalk
// about its foot on the brow, a bulb about the stalk's tip), not about its middle.
import { describe, expect, it } from "vitest";
import { assembleRig, pivotOf } from "./assemble.js";
import { cutNamed } from "./cutNamed.js";
import type { NamedPart, Rgba } from "./types.js";

const SIZE = 100;
/** [y, x] 0..1000 rectangle. */
const rect = (y0: number, x0: number, y1: number, x1: number): [number, number][] => [
  [y0, x0],
  [y0, x1],
  [y1, x1],
  [y1, x0],
];
const part = (name: string, role: NamedPart["role"], poly: [number, number][], extra: Partial<NamedPart> = {}): NamedPart => ({ name, role, box_2d: [0, 0, 1000, 1000], poly, ...extra });

// A head (rows 50..100 of 100), a stalk standing on it (rows 10..50, columns 45..55), a bulb
// hanging off the stalk's tip to the right (rows 10..30, columns 55..75).
const head = part("head", "head", rect(500, 200, 1000, 800));
const stalk = part("stalk", "accessory", rect(100, 450, 500, 550), { follow: "head", motion: { float: { amp: [0, 0], freq: 0.2, rot_deg: 4 } } });
const bulb = part("bulb", "pulse", rect(100, 550, 300, 750), { follow: "stalk", motion: { pulse: { amp: 0.5, freq: 0.5 } } });

describe("pivotOf", () => {
  it("is the middle of where the part meets its target", () => {
    const [x, y] = pivotOf(stalk, head, SIZE, SIZE) ?? [NaN, NaN];
    expect(x).toBeCloseTo(50, 5);
    expect(y).toBeGreaterThan(45);
    expect(y).toBeLessThanOrEqual(50);
  });

  it("is undefined for a part that does not touch its target, and the centroid for a part lying on it", () => {
    expect(pivotOf(part("far", "accessory", rect(0, 0, 100, 100)), head, SIZE, SIZE)).toBeUndefined();
    const [x, y] = pivotOf(part("stamp", "accessory", rect(700, 400, 900, 600)), head, SIZE, SIZE) ?? [NaN, NaN];
    expect([x, y]).toEqual([50, 80]);
  });
});

describe("assembleRig anchors attached parts at their pivot", () => {
  const portrait: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(180) };
  const parts = [bulb, stalk, head];
  const result = assembleRig(parts, cutNamed(portrait, parts).layers, { id: "lure", name: "Lure", portrait });
  const layer = (name: string) => (result.ok ? result.value.rig.layers.find((l) => l.name === name) : undefined);

  it("a stalk turns about its foot on the head and a bulb about the stalk's tip", () => {
    expect(result.ok).toBe(true);
    const [sx, sy] = layer("stalk")?.anchor ?? [NaN, NaN];
    expect(sx).toBeCloseTo(50, 5);
    expect(sy).toBeGreaterThan(45);
    const [bx, by] = layer("bulb")?.anchor ?? [NaN, NaN];
    expect(bx).toBeLessThan(60);
    expect(by).toBeLessThan(31);
  });

  it("a part with no explicit follow, and a float, keep the centroid", () => {
    const loose = [part("stalk", "accessory", stalk.poly), part("bulb", "float", bulb.poly, { follow: "stalk" }), head];
    const r = assembleRig(loose, cutNamed(portrait, loose).layers, { id: "loose", name: "Loose", portrait });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const anchor = (name: string) => r.value.rig.layers.find((l) => l.name === name)?.anchor ?? [NaN, NaN];
    expect(anchor("stalk")[1]).toBeCloseTo(30, 0);
    expect(anchor("bulb")[0]).toBeCloseTo(65, 0);
  });
});
