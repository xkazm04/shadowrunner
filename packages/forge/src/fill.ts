// The pure fill fallback (forge-pipeline requirement 5.3). When the Gemini edit fails or times
// out, the head and torso plates get the holes left by lifted parts (jaw, eyes, ...) painted by
// blurExtend: the surface around each hole is extended inward ring by ring from its edge, then
// smoothed with a few blur passes that only touch the hole. Pure: plain arrays in, a fresh image out.
import type { Mask } from "./mask.js";
import type { Rgba } from "./types.js";

/** Smoothing passes after the hole is filled (softens the ring-by-ring streaks). */
export const FILL_BLUR_PASSES = 4;

export interface FillOptions {
  /** Masked blur passes after the extension; a non-negative integer. Defaults to FILL_BLUR_PASSES. */
  passes?: number;
}

/** Fixed-point scale of the working values. */
const FIXED = 256;

/** 8-neighbour offsets and weights: orthogonal neighbours count twice, so fronts grow rounder. */
const NEIGHBOURS: readonly (readonly [dx: number, dy: number, weight: number])[] = [
  [-1, -1, 1],
  [0, -1, 2],
  [1, -1, 1],
  [-1, 0, 2],
  [1, 0, 2],
  [-1, 1, 1],
  [0, 1, 2],
  [1, 1, 1],
];

/**
 * Fills the hole in `plate` (every pixel where `hole` is non-zero; partial mask values count as
 * hole, so a part's feather band is replaced too). Outward from the hole edge: each round, every
 * hole pixel touching a known pixel takes the weighted mean of its known 8-neighbours, and all of
 * that round's pixels become known together, so the result does not depend on scan order. Then
 * `passes` rounds of a 3x3 weighted blur run on hole pixels only. All four channels are treated
 * alike. Pixels outside the hole are copied unchanged, and every filled value lies within the range
 * of the known pixels bordering the hole. With no hole, or nothing outside it, returns a copy.
 */
export function blurExtend(plate: Rgba, hole: Mask, options: FillOptions = {}): Rgba {
  const { width, height } = plate;
  if (hole.width !== width || hole.height !== height) {
    throw new RangeError(`blurExtend: hole ${hole.width}x${hole.height} does not match plate ${width}x${height}`);
  }
  const passes = options.passes ?? FILL_BLUR_PASSES;
  if (!Number.isInteger(passes) || passes < 0) throw new RangeError(`blurExtend: bad passes ${passes}`);

  const n = width * height;
  const known = new Uint8Array(n);
  const holes: number[] = [];
  for (let i = 0; i < n; i++) {
    if ((hole.data[i] ?? 0) === 0) known[i] = 1;
    else holes.push(i);
  }
  const out = plate.data.slice();
  if (holes.length === 0 || holes.length === n) return { width, height, data: out };

  // Fixed point (1/256 steps) in integers: sums are exact, so the result cannot depend on the order
  // neighbours are added in, and mirrored inputs give mirrored outputs bit for bit.
  const work = Int32Array.from(plate.data, (v) => v * FIXED);
  const at = (i: number, dx: number, dy: number): number => {
    const x = (i % width) + dx;
    const y = Math.floor(i / width) + dy;
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  };

  // Extension: rounds of hole pixels touching known ones, each round read before it is written.
  const queued = new Uint8Array(n);
  let round = holes.filter((i) => NEIGHBOURS.some(([dx, dy]) => known[at(i, dx, dy)] === 1));
  for (const i of round) queued[i] = 1;
  const sums = new Int32Array(4);
  while (round.length > 0) {
    const values = new Int32Array(round.length * 4);
    round.forEach((i, k) => {
      sums.fill(0);
      let weight = 0;
      for (const [dx, dy, w] of NEIGHBOURS) {
        const j = at(i, dx, dy);
        if (j < 0 || known[j] !== 1) continue;
        for (let c = 0; c < 4; c++) sums[c] = (sums[c] ?? 0) + w * (work[j * 4 + c] ?? 0);
        weight += w;
      }
      for (let c = 0; c < 4; c++) values[k * 4 + c] = Math.round((sums[c] ?? 0) / weight);
    });
    const next: number[] = [];
    round.forEach((i, k) => {
      work.set(values.subarray(k * 4, k * 4 + 4), i * 4);
      known[i] = 1;
    });
    for (const i of round) {
      for (const [dx, dy] of NEIGHBOURS) {
        const j = at(i, dx, dy);
        if (j >= 0 && known[j] === 0 && queued[j] === 0) {
          queued[j] = 1;
          next.push(j);
        }
      }
    }
    round = next;
  }

  // Masked blur: the hole pixel itself (weight 4) and its 8 neighbours, known pixels held fixed.
  for (let pass = 0; pass < passes; pass++) {
    const values = new Int32Array(holes.length * 4);
    holes.forEach((i, k) => {
      for (let c = 0; c < 4; c++) sums[c] = 4 * (work[i * 4 + c] ?? 0);
      let weight = 4;
      for (const [dx, dy, w] of NEIGHBOURS) {
        const j = at(i, dx, dy);
        if (j < 0) continue;
        for (let c = 0; c < 4; c++) sums[c] = (sums[c] ?? 0) + w * (work[j * 4 + c] ?? 0);
        weight += w;
      }
      for (let c = 0; c < 4; c++) values[k * 4 + c] = Math.round((sums[c] ?? 0) / weight);
    });
    holes.forEach((i, k) => work.set(values.subarray(k * 4, k * 4 + 4), i * 4));
  }

  for (const i of holes) for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round((work[i * 4 + c] ?? 0) / FIXED);
  return { width, height, data: out };
}
