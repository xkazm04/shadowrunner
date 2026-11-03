// Properties of the pins (costume 3.1): every label and box lands on the glass, every pin sits inside
// the part that carries its light (mapped the way the renderer fits the rig), labels on one side
// never overlap, and the hit test finds the front-most part under a point.
import type { Layer, LayerKind, Rig } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { layerWord } from "./LayerRail";
import { boxOf, layerAt, lightPins, lightPoints, spread, TAG_GAP, TAG_MARGIN, toGlass } from "./pins";

const KINDS: LayerKind[] = ["body", "head", "jaw", "eye", "accessory", "crown"];

/** A rig of `width` x `height` with a background and random boxes inside the canvas. */
const rigArb: fc.Arbitrary<Rig> = fc
  .record({ width: fc.integer({ min: 16, max: 2048 }), height: fc.integer({ min: 16, max: 2048 }) })
  .chain(({ width, height }) =>
    fc
      .array(
        fc.record({
          kind: fc.constantFrom(...KINDS),
          x: fc.double({ min: 0, max: 0.9, noNaN: true }),
          y: fc.double({ min: 0, max: 0.9, noNaN: true }),
          w: fc.double({ min: 0.02, max: 0.5, noNaN: true }),
          h: fc.double({ min: 0.02, max: 0.5, noNaN: true }),
        }),
        { maxLength: 9 },
      )
      .map((parts): Rig => {
        const layers: Layer[] = parts.map((p, i) => {
          const x = Math.round(p.x * width);
          const y = Math.round(p.y * height);
          const w = Math.max(1, Math.min(width - x, Math.round(p.w * width)));
          const h = Math.max(1, Math.min(height - y, Math.round(p.h * height)));
          return { name: `l${i}`, z: i + 2, kind: p.kind, file: `l${i}.png`, bbox: [x, y, w, h], anchor: [x, y] };
        });
        return {
          version: 1,
          id: "prop",
          name: "Prop",
          width,
          height,
          source: "forge",
          palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
          layers: [{ name: "background", z: 1, kind: "static", file: "bg.png", bbox: [0, 0, width, height], anchor: [0, 0] }, ...layers],
        };
      }),
  );

const onGlass = (v: number): boolean => v >= -1e-9 && v <= 100 + 1e-9;

describe("pins on the glass", () => {
  it("maps the canvas whole into the square, centred (contain, like fitView)", () => {
    fc.assert(
      fc.property(rigArb, (rig) => {
        const [x0, y0] = toGlass(rig, [0, 0]);
        const [x1, y1] = toGlass(rig, [rig.width, rig.height]);
        expect(onGlass(x0) && onGlass(y0) && onGlass(x1) && onGlass(y1)).toBe(true);
        // centred, and the longer side fills the glass
        expect(x0 + x1).toBeCloseTo(100, 6);
        expect(y0 + y1).toBeCloseTo(100, 6);
        expect(Math.max(x1 - x0, y1 - y0)).toBeCloseTo(100, 6);
        // aspect kept
        expect((x1 - x0) * rig.height).toBeCloseTo((y1 - y0) * rig.width, 3);
      }),
    );
  });

  it("every pin, label and layer box is on the glass", () => {
    fc.assert(
      fc.property(rigArb, (rig) => {
        for (const pin of lightPins(rig)) {
          expect([...pin.at, ...pin.tag].every(onGlass)).toBe(true);
        }
        for (const layer of rig.layers) {
          const b = boxOf(rig, layer.bbox);
          expect([b.left, b.top, b.left + b.width, b.top + b.height].every(onGlass)).toBe(true);
        }
      }),
    );
  });

  it("gives four pins, one per light, each inside the box of a part (or the head)", () => {
    fc.assert(
      fc.property(rigArb, (rig) => {
        const pins = lightPins(rig);
        expect(pins.map((p) => p.key).sort()).toEqual(["eye", "glow", "mouth", "rim"]);
        const points = lightPoints(rig);
        for (const pin of pins) {
          const [px, py] = points[pin.key];
          expect(px >= 0 && px <= rig.width && py >= 0 && py <= rig.height).toBe(true);
          expect(pin.at[0]).toBeCloseTo(toGlass(rig, points[pin.key])[0], 9);
        }
      }),
    );
  });

  it("labels on one side keep their order and never overlap", () => {
    fc.assert(
      fc.property(rigArb, (rig) => {
        const pins = lightPins(rig);
        for (const side of ["start", "end"] as const) {
          const ys = pins.filter((p) => p.side === side).map((p) => p.tag[1]).sort((a, b) => a - b);
          for (let i = 1; i < ys.length; i += 1) expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(TAG_GAP - 1e-9);
          expect(ys.every((y) => y >= TAG_MARGIN - 1e-9 && y <= 100 - TAG_MARGIN + 1e-9)).toBe(true);
        }
      }),
    );
  });

  it("spread keeps order, bounds and the gap whenever the values fit", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -50, max: 150, noNaN: true }), { maxLength: 8 }), (raw) => {
        const wanted = [...raw].sort((a, b) => a - b);
        const out = spread(wanted, 9, 6, 94);
        expect(out).toHaveLength(wanted.length);
        for (let i = 1; i < out.length; i += 1) expect((out[i] ?? 0) - (out[i - 1] ?? 0)).toBeGreaterThanOrEqual(Math.min(9, 88 / (out.length - 1)) - 1e-9);
        expect(out.every((y) => y >= 6 - 1e-9 && y <= 94 + 1e-9)).toBe(true);
      }),
    );
  });
});

describe("layerAt", () => {
  it("finds the front-most part of the asked kinds under a point, and nothing off every box", () => {
    const rig = testRig();
    const crown = boxOf(rig, [16, 0, 32, 10]);
    expect(layerAt(rig, [crown.left + crown.width / 2, crown.top + 1], ["crown"])?.name).toBe("crown");
    // the monocle (z 8) is in front of the right eye (z 6) where they overlap
    const [mx, my] = toGlass(rig, [39, 20]);
    expect(layerAt(rig, [mx, my], ["eye", "accessory"])?.name).toBe("monocle");
    expect(layerAt(rig, [1, 99], ["crown", "accessory"])).toBeUndefined();
  });

  it("whatever it finds holds the point and is of an asked kind", () => {
    fc.assert(
      fc.property(rigArb, fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (rig, x, y) => {
        const hit = layerAt(rig, [x, y], ["crown", "accessory"]);
        if (hit === undefined) return;
        const b = boxOf(rig, hit.bbox);
        expect(hit.kind === "crown" || hit.kind === "accessory").toBe(true);
        expect(x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height).toBe(true);
      }),
    );
  });

  it("pins the glow only on a part that gives light, and the rail says lit only there (Layer.emissive)", () => {
    const base = testRig();
    const rig = { ...base, layers: base.layers.map((l): Layer => (l.name === "monocle" ? { ...l, bbox: [10, 40, 10, 8] } : l)) };
    const dark = { ...rig, layers: rig.layers.map((l) => (l.name === "monocle" ? { ...l, emissive: false } : l)) };
    const crown = rig.layers.find((l) => l.name === "crown");
    expect(lightPoints(rig).glow).toEqual([15, 44]);
    expect(lightPoints(dark).glow).toEqual([39, 20]); // the second eye: the monocle gives no light
    expect(crown === undefined ? undefined : layerWord(crown)).toBe("floats");
    expect(layerWord({ kind: "accessory" })).toBe("pulses · lit");
    expect(layerWord({ kind: "accessory", emissive: false })).toBe("pulses");
    expect(layerWord({ kind: "eye", emissive: false })).toBe("blinks");
  });
});
