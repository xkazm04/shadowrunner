// cast-forge task 3 golden: Saint Cardia's committed portrait, fill and parts through the real cut
// (liftedNamed, composePlate, cutNamed). Her lips-only jaw carries a human drop; opened by it, the
// middle third of the mouth shows a hard-edged cavity (a handful of flat dark tones, no ramp), and
// the upper lip above the lip line does not move.
import { JAW_DROP_MAX } from "@sr/rig";
import { describe, expect, it } from "vitest";
import portraitUrl from "../../../assets/characters/cast/saint-cardia/portrait.png?inline";
import fillUrl from "../../../assets/characters/cast/saint-cardia/fill.jpg?inline";
import cardiaParts from "../../../assets/characters/cast/saint-cardia/parts.json";
import { compositeRig } from "./composite.js";
import { cutNamed, liftedNamed } from "./cutNamed.js";
import { inlineImage } from "./malakor.fixture.js";
import { luma, rasterizeMask } from "./mask.js";
import { lipLine } from "./mouth.js";
import { parseParts, toCanvas } from "./parts.js";
import { composePlate } from "./plate.js";
import type { Rgba } from "./types.js";

describe("golden (saint-cardia): the open mouth", () => {
  const portrait = inlineImage(portraitUrl);
  const fill = inlineImage(fillUrl);
  const parsed = parseParts(cardiaParts);
  if (!parsed.ok || parsed.value.named === undefined) throw new Error("saint-cardia parts do not parse");
  const named = parsed.value.named;
  const { width, height } = portrait;
  const lifted = liftedNamed(named, width, height);
  const cut = cutNamed(portrait, named, { plate: composePlate(portrait, fill, lifted) });
  const jawPart = named.find((p) => p.role === "jaw");
  const headPart = named.find((p) => p.role === "head");
  if (jawPart === undefined || headPart === undefined) throw new Error("no jaw or head");
  const drop = Math.round((jawPart.drop ?? 0) * height);
  const layers = cut.layers.filter((l) => l.name === jawPart.name || l.name === headPart.name).reverse();
  const rig = { width, height, layers: layers.map((l, z) => ({ name: l.name, z, kind: l.role === "jaw" ? ("jaw" as const) : ("head" as const), file: l.name, bbox: l.bbox, anchor: [0, 0] as [number, number] })) };
  const images = Object.fromEntries(layers.map((l) => [l.name, l.image]));
  const open = compositeRig(rig, images, { jaw: drop });
  const rest = compositeRig(rig, images, { jaw: 0 });
  const top = lipLine(rasterizeMask(toCanvas(jawPart.poly, width, height), width, height, 0));
  const xs = [...top.keys()].filter((x) => (top[x] ?? -1) >= 0);
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? 0;
  const at = (img: Rgba, x: number, y: number): number[] => Array.from(img.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3));

  it("has a human jaw travel (a lips-only jaw, well under the skull's 0.06)", () => {
    expect(jawPart.drop).toBeGreaterThanOrEqual(0.01);
    expect(jawPart.drop).toBeLessThanOrEqual(Math.min(0.025, JAW_DROP_MAX));
    expect(x1 - x0).toBeGreaterThan(40);
  });

  it("opened, the middle third of the mouth is a hard-edged dark cavity (at most 3 flat tones)", () => {
    const tones = new Set<string>();
    let dark = 0;
    let n = 0;
    const third = Math.round((x1 - x0) / 3);
    for (let x = x0 + third; x <= x1 - third; x++) {
      const lip = top[x] ?? 0;
      for (let y = lip; y < lip + Math.round(drop * 0.75); y++) {
        const [r = 0, g = 0, b = 0] = at(open, x, y);
        tones.add(`${r},${g},${b}`);
        n++;
        if (luma(r, g, b) < 30) dark++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(dark / n).toBeGreaterThan(0.97);
    expect([...tones].length).toBeLessThanOrEqual(3);
  });

  it("the upper lip does not move: above the lip line, open equals rest", () => {
    const moved: string[] = [];
    for (let x = x0; x <= x1; x++) {
      const lip = top[x] ?? 0;
      for (let y = lip - 12; y < lip; y++) if (at(open, x, y).join() !== at(rest, x, y).join()) moved.push(`(${x}, ${y})`);
    }
    expect(moved.slice(0, 5)).toEqual([]);
  });
});
