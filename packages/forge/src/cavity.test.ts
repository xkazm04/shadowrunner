// cast-forge task 4: a jaw's `cavity`. "fill" (a mouth the drawing already shows open, the Vicar's
// maw of teeth over a lit throat) leaves the fill plate under the jaw: no lens hung from a jagged
// line between the teeth. "paint" (the default) paints the cavity as task 3 does.
import { describe, expect, it } from "vitest";
import { cutNamed } from "./cutNamed.js";
import { parseParts } from "./parts.js";
import type { NamedPart, Rgba } from "./types.js";

const SIZE = 40;
const flat = (v: [number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) data.set([...v, 255], i * 4);
  return { width: SIZE, height: SIZE, data };
};
const rect = (y0: number, x0: number, y1: number, x1: number): [number, number][] => [
  [y0, x0],
  [y0, x1],
  [y1, x1],
  [y1, x0],
];
const head: NamedPart = { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: rect(0, 0, 1000, 1000) };
const jaw = (extra: Partial<NamedPart>): NamedPart => ({ name: "maw", role: "jaw", box_2d: [0, 0, 1000, 1000], poly: rect(500, 250, 800, 750), drop: 0.1, ...extra });

/** The head layer's colours in the band an open jaw uncovers (just under the lip line, mid-jaw). */
function uncovered(part: NamedPart): string[] {
  const plate = flat([90, 20, 70]);
  const cut = cutNamed(flat([200, 200, 200]), [jaw(part), head], { plate, feather: 0 });
  const layer = cut.layers.find((l) => l.name === "face");
  if (layer === undefined) throw new Error("no head layer");
  const [bx, by] = layer.bbox;
  const out = new Set<string>();
  for (let y = 21; y < 23; y++) {
    for (let x = 18; x < 22; x++) {
      const i = ((y - by) * layer.image.width + (x - bx)) * 4;
      out.add(Array.from(layer.image.data.subarray(i, i + 3)).join(","));
    }
  }
  return [...out];
}

describe("jaw cavity", () => {
  it('"fill": an open jaw uncovers the fill plate, unpainted', () => {
    expect(uncovered(jaw({ cavity: "fill" }))).toEqual(["90,20,70"]);
  });

  it('"paint" and the default paint the cavity over the plate', () => {
    expect(uncovered(jaw({}))).not.toContain("90,20,70");
    expect(uncovered(jaw({ cavity: "paint" }))).toEqual(uncovered(jaw({})));
  });

  it("parses cavity on a jaw only, never with a glow", () => {
    const entry = (role: NamedPart["role"], extra: Record<string, unknown>) => ({ name: role === "head" ? "face" : "maw", role, box_2d: [0, 0, 1000, 1000], poly: rect(0, 0, 1000, 1000), ...extra });
    const ok = parseParts({ version: 2, parts: [entry("head", {}), entry("jaw", { cavity: "fill", drop: 0.035 })] });
    expect(ok.ok && ok.value.named?.[1]?.cavity).toBe("fill");
    const bad = parseParts({ version: 2, parts: [entry("head", { cavity: "fill" }), entry("jaw", { cavity: "open" })] });
    expect(bad.ok ? [] : bad.errors.map((e) => e.path)).toEqual(["$.parts[0].cavity", "$.parts[1].cavity"]);
    const glowing = parseParts({ version: 2, parts: [entry("head", {}), entry("jaw", { cavity: "fill", glow: "#ff2fd0" })] });
    expect(glowing.ok ? [] : glowing.errors.map((e) => e.path)).toEqual(["$.parts[1].glow"]);
  });
});
