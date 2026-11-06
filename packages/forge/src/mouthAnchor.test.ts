// measureMouth (llm-avatar-lab): the lip line, centre and width of a synthetic jaw strip; and
// round 3's rule that a mouth drawn open (a visor, a maw: `drawnMouth`) leaves the rig without `mouth`.
import { describe, expect, it } from "vitest";
import { assembleRig } from "./assemble.js";
import { cutNamed, liftedNamed } from "./cutNamed.js";
import { MOUTH_OF_HEAD, MOUTH_OF_JAW, drawnMouth, measureMouth } from "./mouthAnchor.js";
import { composePlate, fallbackFill } from "./plate.js";
import type { NamedPart, Rgba } from "./types.js";

/** A w x h jaw image whose column x is opaque from row `tops(x)` down (-1: empty column). */
function strip(w: number, h: number, tops: (x: number) => number, alpha = 255): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) {
    const t = tops(x);
    if (t < 0) continue;
    for (let y = t; y < h; y++) data[(y * w + x) * 4 + 3] = alpha;
  }
  return { width: w, height: h, data };
}

describe("measureMouth", () => {
  it("a flat strip: the lip line is its top edge, centred, 0.85 of its span", () => {
    const m = measureMouth({ bbox: [448, 493, 130, 22], image: strip(130, 22, () => 0) });
    expect(m).toEqual({ cx: 513, lineY: 493, width: 130 * MOUTH_OF_JAW });
  });

  it("uses only the opaque column span (transparent margins ignored)", () => {
    const m = measureMouth({ bbox: [100, 50, 60, 10], image: strip(60, 10, (x) => (x < 10 || x >= 50 ? -1 : 2)) });
    expect(m).toEqual({ cx: 100 + 10 + 20, lineY: 52, width: 40 * MOUTH_OF_JAW });
  });

  it("takes the median over the middle 60%: drooping corners and a single notch do not move it", () => {
    // 100 columns: corners (outer 20 each side) start at row 8, the middle at row 3, one notch at row 0.
    const m = measureMouth({ bbox: [0, 100, 100, 12], image: strip(100, 12, (x) => (x === 50 ? 0 : x < 20 || x >= 80 ? 8 : 3)) });
    expect(m?.lineY).toBe(103);
  });

  it("caps the width at the head's width times 0.32", () => {
    const m = measureMouth({ bbox: [0, 0, 200, 10], image: strip(200, 10, () => 0) }, { bbox: [0, 0, 300, 400] });
    expect(m?.width).toBeCloseTo(300 * MOUTH_OF_HEAD);
    const wide = measureMouth({ bbox: [0, 0, 100, 10], image: strip(100, 10, () => 0) }, { bbox: [0, 0, 1000, 400] });
    expect(wide?.width).toBeCloseTo(100 * MOUTH_OF_JAW);
  });

  it("reads a mask as well as an Rgba, and ignores faint alpha in an Rgba", () => {
    const data = new Uint8ClampedArray(20 * 5);
    for (let y = 1; y < 5; y++) for (let x = 0; x < 20; x++) data[y * 20 + x] = 255;
    expect(measureMouth({ bbox: [10, 10, 20, 5], image: { width: 20, height: 5, data } })).toEqual({ cx: 20, lineY: 11, width: 20 * MOUTH_OF_JAW });
    expect(measureMouth({ bbox: [0, 0, 20, 5], image: strip(20, 5, () => 0, 40) })).toBeUndefined();
  });

  it("undefined for an empty jaw", () => {
    expect(measureMouth({ bbox: [0, 0, 4, 4], image: strip(4, 4, () => -1) })).toBeUndefined();
  });
});

describe("drawnMouth (round 3: a lipless mouth keeps its art)", () => {
  it("true only for a jaw part with cavity gap or fill; paint, glow alone and v1 parts are lips", () => {
    expect(drawnMouth([{ role: "jaw", cavity: "gap" }])).toBe(true); // Sir Vacant's bevor, Reveille's grin
    expect(drawnMouth([{ role: "head" }, { role: "jaw", cavity: "fill" }])).toBe(true); // the Vicar's maw
    expect(drawnMouth([{ role: "jaw", cavity: "paint" }, { role: "jaw" }])).toBe(false);
    expect(drawnMouth([{ role: "jaw" }])).toBe(false); // the Tallyman: a glow but a lip
    expect(drawnMouth([{ role: "accessory", cavity: "gap" }])).toBe(false);
    expect(drawnMouth([{ name: "jaw" } as { role?: string }])).toBe(false);
    expect(drawnMouth([{ role: "jaw", mouth: "art" }])).toBe(true); // a skull's grin: the flag, the cavity stays painted
    expect(drawnMouth([{ role: "jaw", mouth: "lip" }, { role: "head", mouth: "art" }])).toBe(false);
  });

  // A 200 px face: a head with a lower-lip jaw under it, cut and assembled as the live brief path does.
  const SIZE = 200;
  const portrait: Rgba = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4).map((_, i) => (i % 4 === 3 ? 255 : 150)) };
  const face = (jaw: Partial<NamedPart>): NamedPart[] => [
    { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[100, 250], [100, 750], [600, 750], [600, 250]] },
    { name: "jaw", role: "jaw", box_2d: [0, 0, 1000, 1000], poly: [[600, 350], [600, 650], [680, 650], [680, 350]], drop: 0.02, ...jaw },
  ];
  const assemble = (parts: NamedPart[]) => {
    const lifted = liftedNamed(parts, SIZE, SIZE);
    const plate = composePlate(portrait, fallbackFill(portrait, lifted), lifted);
    const cut = cutNamed(portrait, parts, { plate });
    const out = assembleRig(parts, cut.layers, { id: "t", name: "T", portrait, plate });
    if (!out.ok) throw new Error(out.errors.map((e) => e.message).join("; "));
    return out.value.rig;
  };

  it("assembleRig: a lip jaw (paint, or glow alone) gets mouth; a gap or fill jaw leaves it absent", () => {
    for (const jaw of [{}, { cavity: "paint" as const }, { glow: "#6d8c19" }]) expect(assemble(face(jaw)).mouth, JSON.stringify(jaw)).toBeDefined();
    for (const cavity of ["gap", "fill"] as const) {
      const rig = assemble(face({ cavity }));
      expect(rig.mouth, cavity).toBeUndefined();
      expect("mouth" in rig, cavity).toBe(false); // omitted, never undefined
      expect(rig.layers.some((l) => l.kind === "jaw")).toBe(true);
    }
  });

  it("assembleRig (art-mouth): measures the painted lips on the rest head + jaw; flat art leaves lips omitted", () => {
    expect("lips" in (assemble(face({})).mouth ?? {})).toBe(false);
    const lipped: Rgba = { ...portrait, data: portrait.data.slice() };
    // A red lip ellipse about the jaw's top edge (row 120, x 100): rx 16, ry 8.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (((x + 0.5 - 100) / 16) ** 2 + ((y + 0.5 - 120) / 8) ** 2 > 1) continue;
        lipped.data.set([190, 70, 80], (y * SIZE + x) * 4);
      }
    }
    const parts = face({});
    const lifted = liftedNamed(parts, SIZE, SIZE);
    const plate = composePlate(lipped, fallbackFill(lipped, lifted), lifted);
    const out = assembleRig(parts, cutNamed(lipped, parts, { plate }).layers, { id: "t", name: "T", portrait: lipped, plate });
    expect(out.ok).toBe(true);
    const lips = out.ok ? out.value.rig.mouth?.lips : undefined;
    expect(lips).toBeDefined();
    if (lips === undefined) return;
    for (const [got, want] of [[lips.left, 84], [lips.right, 116], [lips.upper, 112], [lips.lower, 128]] as const) expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
  });
});
