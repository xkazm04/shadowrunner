// character-control design.md "Expressions" (requirement 5.1): the prompt pinned to the design text,
// the face mask, and `cutVariants` on a synthetic rig: nothing outside the mask changes, the patch
// modes and files, and the drift flag.
import { EXPRESSION_FAMILIES, type Layer, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import design from "../../../.kiro/specs/character-control/design.md?raw";
import { EXPRESSION_DRIFT_LIMIT, EXPRESSION_FACES, cutVariants, expressionPrompt, faceMask } from "./expressions.js";
import type { Rgba } from "./types.js";

/** design.md with its line breaks and indentation folded to single spaces (CRLF too). */
const DESIGN = design.replace(/\r\n/g, "\n").replace(/\s+/g, " ");

describe("expressionPrompt", () => {
  it("each family's FACE is design.md's, verbatim", () => {
    for (const family of EXPRESSION_FAMILIES) expect(DESIGN, family).toContain(`${family} "${EXPRESSION_FACES[family]}"`);
  });

  it("the frame is design.md's, verbatim, with the name and FACE filled in; a style adds one sentence", () => {
    const frame = /"(Edit this portrait of \{name\}\. .*?Do not add or remove objects\.)"/.exec(DESIGN)?.[1];
    if (frame === undefined) throw new Error("design.md has no prompt frame");
    for (const family of EXPRESSION_FAMILIES) {
      expect(expressionPrompt("Reveille", family)).toBe(frame.replace("{name}", "Reveille").replace("{FACE}", EXPRESSION_FACES[family]));
    }
    expect(expressionPrompt("Lot Ninety", "smug", "art nouveau poster")).toBe(`${expressionPrompt("Lot Ninety", "smug")} The art style is art nouveau poster.`);
  });
});

// A 120 x 120 canvas: a grey head, two eyes, a jaw and one brow; a torso below that is not a face part.
const W = 120;
const solid = (w: number, h: number, rgb: [number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
};
const LAYERS: (Pick<Layer, "name" | "kind" | "bbox"> & { rgb: [number, number, number] })[] = [
  { name: "torso", kind: "body", bbox: [0, 100, 120, 20], rgb: [60, 40, 30] },
  { name: "head", kind: "head", bbox: [20, 10, 80, 90], rgb: [150, 140, 130] },
  { name: "brow_l", kind: "accessory", bbox: [36, 30, 16, 4], rgb: [40, 30, 20] },
  { name: "eye_l", kind: "eye", bbox: [38, 40, 12, 6], rgb: [40, 220, 200] },
  { name: "eye_r", kind: "eye", bbox: [70, 40, 12, 6], rgb: [40, 220, 200] },
  { name: "jaw", kind: "jaw", bbox: [45, 76, 30, 10], rgb: [120, 60, 60] },
];
const RIG: Rig = {
  version: 1,
  id: "t",
  name: "T",
  width: W,
  height: W,
  source: "forge",
  palette: { glow: "#ffffff", eye: "#28dcc8", rim: "#ffffff", mouth: "#000000" },
  layers: LAYERS.map(({ name, kind, bbox }, z) => ({ name, kind, bbox, z: z + 2, file: `${name}.png`, anchor: [bbox[0], bbox[1]] })),
};
const IMAGES = new Map(LAYERS.map((l) => [l.name, solid(l.bbox[2], l.bbox[3], l.rgb)]));

/** The layers drawn back to front over black: the portrait they were cut from. */
function portrait(): Rgba {
  const out = solid(W, W, [0, 0, 0]);
  for (const l of LAYERS) {
    const [bx, by, w, h] = l.bbox;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data.set([...l.rgb, 255], ((by + y) * W + bx + x) * 4);
  }
  return out;
}

/** `image` with `shift` added to every channel where `where(x, y)`. */
function shifted(image: Rgba, shift: number, where: (x: number, y: number) => boolean = () => true): Rgba {
  const data = image.data.slice();
  for (let i = 0; i < W * W; i++) if (where(i % W, Math.floor(i / W))) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  return { ...image, data };
}

describe("faceMask", () => {
  it("covers the eyes, brow, jaw and the face band of the head; not the torso or the head's crown", () => {
    const mask = faceMask(RIG, IMAGES);
    const alpha = (x: number, y: number) => mask.data[(y * W + x) * 4 + 3] ?? 0;
    expect([mask.width, mask.height]).toEqual([W, W]);
    expect(alpha(44, 43)).toBe(255);
    expect(alpha(60, 80)).toBe(255);
    expect(alpha(60, 60)).toBe(255);
    expect(alpha(60, 12)).toBe(0); // above the band: brow top 30 - 6% of 90 - dilation 2
    expect(alpha(60, 117)).toBe(0); // the torso, below the band
  });
});

describe("cutVariants", () => {
  it("every patch pixel outside the mask equals the base; eyes, jaw and brow replace whole layers, the head is over and cropped", () => {
    const base = portrait();
    const cut = cutVariants(RIG, IMAGES, base, shifted(base, 40), "anger");
    const mask = faceMask(RIG, IMAGES);
    expect(Object.keys(cut.patches).sort()).toEqual(["brow_l", "eye_l", "eye_r", "head", "jaw"]);
    let outside = 0;
    for (const [name, { patch, image }] of Object.entries(cut.patches)) {
      const layer = RIG.layers.find((l) => l.name === name);
      const own = IMAGES.get(name);
      if (layer === undefined || own === undefined) throw new Error(name);
      expect(patch.file).toBe(`${name}.anger.png`);
      expect(patch.mode).toBe(name === "head" ? "over" : "replace");
      if (patch.mode === "replace") expect(patch.bbox).toEqual(layer.bbox);
      const [px, py, pw, ph] = patch.bbox;
      expect([image.width, image.height]).toEqual([pw, ph]);
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const cx = px + x;
          const cy = py + y;
          if ((mask.data[(cy * W + cx) * 4 + 3] ?? 0) !== 0) continue;
          outside++;
          const o = ((cy - layer.bbox[1]) * own.width + cx - layer.bbox[0]) * 4;
          expect([...image.data.subarray((y * pw + x) * 4, (y * pw + x) * 4 + 4)]).toEqual([...own.data.subarray(o, o + 4)]);
        }
      }
    }
    expect(outside).toBeGreaterThan(0);
    const head = cut.patches.head?.patch.bbox;
    expect(head !== undefined && head[2] * head[3] < 80 * 90).toBe(true);
  });

  it("the head keeps its base under the eyes, brow and jaw (the plate and the painted cavity)", () => {
    const base = portrait();
    const cut = cutVariants(RIG, IMAGES, base, shifted(base, 40), "joy");
    const head = cut.patches.head;
    if (head === undefined) throw new Error("no head patch");
    const [px, py, pw] = head.patch.bbox;
    const o = ((43 - py) * pw + 44 - px) * 4; // under eye_l
    expect([...head.image.data.subarray(o, o + 3)]).toEqual([150, 140, 130]);
  });

  it("drift: an edit that changes only the eyes is not flagged; one that shifts the whole frame is", () => {
    const base = portrait();
    const eyes = cutVariants(RIG, IMAGES, base, shifted(base, 60, (x, y) => y >= 40 && y < 46 && ((x >= 38 && x < 50) || (x >= 70 && x < 82))), "gloom");
    expect(eyes.drift).toBe(0);
    expect(eyes.flagged).toBe(false);
    expect(Object.keys(eyes.patches).sort()).toEqual(["eye_l", "eye_r"]);
    const all = cutVariants(RIG, IMAGES, base, shifted(base, 60), "gloom");
    expect(all.drift).toBeGreaterThan(EXPRESSION_DRIFT_LIMIT);
    expect(all.flagged).toBe(true);
  });

  it("an unchanged edit gives no patches; a wrong-size edit throws", () => {
    const base = portrait();
    expect(cutVariants(RIG, IMAGES, base, base, "smug").patches).toEqual({});
    expect(() => cutVariants(RIG, IMAGES, base, solid(64, 64, [0, 0, 0]), "smug")).toThrow(RangeError);
  });
});
