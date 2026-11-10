// perfection-pass task 16: the foreground, the coverage check and the stage that keeps every piece,
// on a synthetic 250 px bust (a bright head and torso on a black ground; 4 part units per px, so
// the polygons fall on pixel edges). No network.
import { type Layer, type Rig, poseLayers, defaultLook } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { COVER_SPECK, convexHull, distanceBelow, dropSpecks, foregroundOf, nearerHead } from "./cover.js";
import { coverReport, covers } from "./coverCheck.js";
import { keepEveryPiece } from "./coverFix.js";
import type { Part, Rgba } from "./types.js";

const S = 250;
type Rect = [x0: number, y0: number, x1: number, y1: number];

/** A part over `rect` (canvas px) in the parts' 0-1000 [y, x] coordinates. */
const part = (name: Part["name"], [x0, y0, x1, y1]: Rect): Part => {
  const k = 1000 / S;
  const poly: [number, number][] = [
    [y0 * k, x0 * k],
    [y0 * k, x1 * k],
    [y1 * k, x1 * k],
    [y1 * k, x0 * k],
  ];
  return { name, box_2d: [y0 * k, x0 * k, y1 * k, x1 * k], poly };
};

/** An opaque image of `ground` with each rect painted its grey, later ones on top. */
function paint(ground: number, rects: readonly [Rect, number][]): Rgba {
  const data = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) data.set([ground, ground, ground, 255], i * 4);
  for (const [[x0, y0, x1, y1], grey] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([grey, grey + 10, grey - 10, 255], (y * S + x) * 4);
  return { width: S, height: S, data };
}

/** `image` inside `rect`, transparent elsewhere, cropped to the rect: a hard cut layer. */
function cut(image: Rgba, [x0, y0, x1, y1]: Rect, minus?: Rect): Rgba {
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x0 + x;
      const cy = y0 + y;
      if (minus !== undefined && cx >= minus[0] && cx < minus[2] && cy >= minus[1] && cy < minus[3]) continue;
      data.set(image.data.subarray((cy * S + cx) * 4, (cy * S + cx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

const HEAD: Rect = [80, 32, 176, 176];
const TORSO: Rect = [32, 200, 224, 250];
/** Between the head and the torso, in no polygon: the Announcer's grille. */
const GRILLE: Rect = [96, 176, 160, 200];

/** A rig of backdrop, torso and head cut from `portrait`; the torso loses what the head covers. */
function bust(portrait: Rgba, head: Rect, torso: Rect): { rig: Rig; images: Record<string, Rgba> } {
  const layer = (name: string, kind: Layer["kind"], z: number, [x0, y0, x1, y1]: Rect, anchor: [number, number]): Layer => ({
    name,
    kind,
    z,
    file: `${name}.png`,
    bbox: [x0, y0, x1 - x0, y1 - y0],
    anchor,
  });
  const rig: Rig = {
    version: 1,
    id: "bust",
    name: "Bust",
    width: S,
    height: S,
    source: "forge",
    fictional: true,
    palette: {
      glow: "#000000",
      eye: "#000000",
      rim: "#000000",
      mouth: "#000000",
    },
    layers: [
      layer("background", "static", 1, [0, 0, S, S], [S / 2, S / 2]),
      layer("torso", "body", 2, torso, [(torso[0] + torso[2]) / 2, (torso[1] + torso[3]) / 2]),
      layer("head", "head", 3, head, [(head[0] + head[2]) / 2, head[3]]),
    ],
  };
  return {
    rig,
    images: {
      "background.png": portrait,
      "torso.png": cut(portrait, torso, head),
      "head.png": cut(portrait, head),
    },
  };
}

describe("foregroundOf", () => {
  it("keys the ground out and keeps a lit piece between the parts, but not a speck apart from them", () => {
    const portrait = paint(4, [
      [HEAD, 200],
      [TORSO, 150],
      [GRILLE, 120],
      [[70, 150, 76, 156], 220], // inside the hull, not touching the character
      [[4, 4, 12, 12], 220], // outside the hull
    ]);
    const fg = foregroundOf(portrait, [part("head", HEAD), part("torso", TORSO)]).data;
    const at = (x: number, y: number): number => fg[y * S + x] ?? -1;
    expect(at(128, 188)).toBe(255);
    expect(at(128, 100)).toBe(255);
    expect(at(73, 153)).toBe(0);
    expect(at(8, 8)).toBe(0);
    expect(at(40, 100)).toBe(0);
  });

  it("on a ground that is not dark, only the polygons count", () => {
    const portrait = paint(120, [
      [HEAD, 200],
      [TORSO, 150],
      [GRILLE, 60],
    ]);
    const fg = foregroundOf(portrait, [part("head", HEAD), part("torso", TORSO)]).data;
    expect(fg[188 * S + 128]).toBe(0);
    expect(fg[100 * S + 128]).toBe(255);
  });
});

describe("cover helpers", () => {
  it("convexHull keeps the corners only", () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [2, 1],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(
      expect.arrayContaining([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
    );
  });

  it("dropSpecks removes pieces under the speck size and counts the rest", () => {
    const w = 64;
    const mask = new Uint8Array(w * w);
    for (let i = 0; i < 4; i++) mask[i] = 1; // a 4 px crumb
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) mask[y * w + x] = 1; // 100 px
    expect(dropSpecks(mask, w, COVER_SPECK)).toBe(100);
    expect(mask[0]).toBe(0);
  });

  it("nearerHead splits by distance, a tie to the body; distanceBelow looks down the column", () => {
    const w = 10;
    const head = new Uint8Array(w * w);
    const body = new Uint8Array(w * w);
    head[0] = 1;
    body[9 * w + 9] = 1;
    const owner = nearerHead(head, body, w);
    expect(owner[1]).toBe(1);
    expect(owner[8 * w + 8]).toBe(0);
    const below = distanceBelow(body, w, w);
    expect(below[2 * w + 9]).toBe(7);
    expect(below[9 * w + 9]).toBe(Infinity);
  });
});

describe("coverage check and keepEveryPiece", () => {
  it("a piece in no layer fails the check at rest; the stage gives it to the body and the rest view is unchanged", () => {
    const portrait = paint(4, [
      [HEAD, 200],
      [TORSO, 150],
      [GRILLE, 120],
    ]);
    const parts = [part("head", HEAD), part("torso", TORSO)];
    const { rig, images } = bust(portrait, HEAD, TORSO);
    const before = coverReport(rig, images, portrait, parts);
    expect(before.uncovered).toBe((GRILLE[2] - GRILLE[0]) * (GRILLE[3] - GRILLE[1]));
    expect(covers(before)).toBe(false);

    const fixed = keepEveryPiece({
      rig,
      images,
      portrait,
      background: portrait,
      parts,
    });
    expect(fixed.changed).toContain("torso");
    const after = coverReport(fixed.rig, { ...fixed.images, "background.png": fixed.background }, portrait, parts);
    expect(after.uncovered).toBe(0);
    expect(covers(after)).toBe(true);
    // The grille rides the body: the torso layer now starts at the grille.
    expect(fixed.rig.layers.find((l) => l.name === "torso")?.bbox[1]).toBeLessThanOrEqual(GRILLE[1]);
  });

  it("a head over the body that the body does not reach under fails at a limit pose; the stage reaches under it", () => {
    const head: Rect = [80, 32, 176, 224];
    const portrait = paint(4, [
      [TORSO, 150],
      [head, 200],
    ]);
    const parts = [part("head", head), part("torso", TORSO)];
    const { rig, images } = bust(portrait, head, TORSO);
    const before = coverReport(rig, images, portrait, parts);
    expect(before.uncovered).toBe(0);
    expect(before.neckGaps).toBeGreaterThan(0);
    expect(before.reach).toBeGreaterThan(0);

    const fixed = keepEveryPiece({
      rig,
      images,
      portrait,
      background: portrait,
      parts,
    });
    expect(fixed.neck).toBeGreaterThan(0);
    const after = coverReport(fixed.rig, { ...fixed.images, "background.png": fixed.background }, portrait, parts);
    expect(after.neckGaps).toBe(0);
    // Still hidden at rest: the head is unchanged and the posed rest frame keeps every layer at its box.
    const rest = poseLayers(fixed.rig, defaultLook(fixed.rig), {
      t: 0,
      headYaw: 0,
      headPitch: 0,
      jawOpen: 0,
      blink: 0,
      still: true,
    });
    for (const p of rest) {
      const layer = fixed.rig.layers.find((l) => l.name === p.name);
      expect([p.x, p.y]).toEqual([expect.closeTo(layer?.bbox[0] ?? -1, 6), expect.closeTo(layer?.bbox[1] ?? -1, 6)]);
    }
    expect(fixed.images["head.png"]).toBe(images["head.png"]);
  });
});
