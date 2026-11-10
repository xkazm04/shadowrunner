// Coverage (perfection-pass task 16, requirement 16): the cut must keep every piece of the
// character. The studio cutout and the stage hide the backdrop layer, so a piece of the portrait that
// no character layer holds (the Announcer's chest grille, found by task 15) shows the page through.
// - Foreground: the parts model gives polygons, not a matte, and a polygon can miss a piece (the
//   grille lies between the head's and the torso's outline). What the forge already knows of the
//   ground is its luma key (ruling 2: the portraits are asked for on a dark ground, `cornerKeyLo`), so
//   the foreground is the key, inside the convex hull of the parts, connected to the parts (a lit
//   speck of ground floating apart from the character is not foreground), plus the dark it encloses
//   (the shadow under a hood). On a ground that is not dark (corner median at or above KEY_HI) the
//   key cannot tell, and only the polygons count. A dark piece that touches the ground (a black coat
//   against black) stays ground: telling it apart needs a matte, which the forge does not record.
// - The neck: the backdrop also hid what a turned or tilted head uncovers. Where the head group lies
//   over the body (the body is in the same column within `reach` px below), the body must still
//   cover it at every pose within the rig's limits (coverPose.ts `limitPoses`).
// Pure: plain arrays in, fresh arrays out.
import { type Rig, turnHead } from "@sr/rig";
import { SOLID_ALPHA } from "./background.js";
import { KEY_CORNER_PATCH, KEY_HI, type Mask, cornerKeyLo, dilateMask, luma, lumaKey, rasterizeMask } from "./mask.js";
import { toCanvas } from "./parts.js";
import { type Images, REST_DRIVE, coverage, posesAt } from "./coverPose.js";
import type { NamedPart, Part, Polygon, Rgba } from "./types.js";

export * from "./coverPose.js";

/** A pixel counts as covered from this composited alpha (0..1) up. */
export const COVERED = 0.5;
/** A layer's pixel counts as solid from this alpha up (as the painted background counts it). */
export const SOLID = SOLID_ALPHA;
/** Uncovered pieces smaller than this many px are crumbs of an anti-aliased edge, not missing pieces. */
export const COVER_SPECK = 32;
/** The neck reach never exceeds this many px (a head that moves further is not a 2.5D head). */
export const REACH_MAX = 128;
/** Px added to the measured neck reach, for the nearest-pixel sampling of a turned layer. */
export const REACH_MARGIN = 3;

/** Convex hull (monotone chain) of the points, counter-clockwise; fewer than 3 points come back as given. */
export function convexHull(points: readonly [number, number][]): Polygon {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p.map(([x, y]) => [x, y]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2] ?? q, out[out.length - 1] ?? q, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Median luma of the four KEY_CORNER_PATCH px corner patches (what the ground mostly is). */
export function cornerMedian(image: Rgba): number {
  const pw = Math.min(KEY_CORNER_PATCH, image.width);
  const ph = Math.min(KEY_CORNER_PATCH, image.height);
  const values: number[] = [];
  for (const [cx, cy] of [
    [0, 0],
    [image.width - pw, 0],
    [0, image.height - ph],
    [image.width - pw, image.height - ph],
  ] as const) {
    for (let y = cy; y < cy + ph; y++) {
      for (let x = cx; x < cx + pw; x++) {
        const i = (y * image.width + x) * 4;
        values.push(luma(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0));
      }
    }
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

/** Px of partly keyed edge kept around the solid foreground (its anti-aliased rim, not the glow beyond). */
export const FOREGROUND_RIM = 2;
/** Px the foreground is closed by: a dark gap inside the character narrower than twice this is foreground. */
export const FOREGROUND_CLOSE = 3;

/**
 * The portrait's foreground, 0..255 (see the header), from the luma key (`lumaKey(min(cornerKeyLo,
 * KEY_HI - 1), KEY_HI)`, as `cutAll` keys): 255 on every fully keyed pixel reached from a part's
 * polygon through fully keyed pixels inside the parts' convex hull (4-connected), the key's value on
 * the partly keyed pixels within FOREGROUND_RIM px of those (their edge; a haze or glow further out
 * is ground), and 255 on what that encloses; 0 elsewhere. On a ground that is not dark, 255 inside
 * the parts' polygons, 0 outside.
 */
export function foregroundOf(portrait: Rgba, parts: readonly (Part | NamedPart)[]): Mask {
  const { width, height } = portrait;
  const polys = parts.map((p) => toCanvas(p.poly, width, height));
  const union = new Uint8Array(width * height);
  for (const poly of polys) rasterizeMask(poly, width, height, 0).data.forEach((a, i) => a !== 0 && (union[i] = 1));
  const out: Mask = {
    width,
    height,
    data: new Uint8ClampedArray(width * height),
  };
  if (cornerMedian(portrait) >= KEY_HI) {
    union.forEach((u, i) => u === 1 && (out.data[i] = 255));
    return out;
  }
  const hull = rasterizeMask(convexHull(polys.flat()), width, height, 0).data;
  const key = lumaKey(portrait, Math.min(cornerKeyLo(portrait), KEY_HI - 1), KEY_HI).data;
  const inside = (i: number): boolean => (hull[i] ?? 0) !== 0 || union[i] === 1;
  const around = (i: number): number[] => {
    const x = i % width;
    return [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width].filter((j) => j >= 0 && j < union.length);
  };
  let front: number[] = [];
  for (let i = 0; i < union.length; i++)
    if (union[i] === 1 && key[i] === 255) {
      out.data[i] = 255;
      front.push(i);
    }
  const stack = [...front];
  while (stack.length > 0) {
    for (const j of around(stack.pop() ?? 0)) {
      if (out.data[j] !== 0 || key[j] !== 255 || !inside(j)) continue;
      out.data[j] = 255;
      stack.push(j);
      front.push(j);
    }
  }
  for (let ring = 0; ring < FOREGROUND_RIM; ring++) {
    const next: number[] = [];
    for (const i of front) {
      for (const j of around(i)) {
        if (out.data[j] !== 0 || (key[j] ?? 0) === 0 || !inside(j)) continue;
        out.data[j] = key[j] ?? 0;
        next.push(j);
      }
    }
    front = next;
  }
  // A shadow the character encloses (the black under a hood, a mesh's holes) keys like ground but is
  // not. Ground is what the canvas edge reaches without crossing the foreground or a part's polygon grown by
  // FOREGROUND_CLOSE px (so a dark channel narrower than twice that does not let it in), grown back
  // by sqrt(2) times as much (so the ground reaches back into a square corner); every other pixel is
  // foreground: the enclosed shadows.
  const grownFg = dilateMask(
    {
      width,
      height,
      data: out.data.map((v, i) => (v !== 0 || union[i] === 1 ? 255 : 0)),
    },
    FOREGROUND_CLOSE,
  ).data;
  const reached = new Uint8ClampedArray(width * height);
  const edge: number[] = [];
  for (let i = 0; i < reached.length; i++) {
    const x = i % width;
    const y = (i - x) / width;
    if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && grownFg[i] === 0) {
      reached[i] = 255;
      edge.push(i);
    }
  }
  while (edge.length > 0) {
    for (const j of around(edge.pop() ?? 0)) {
      if (reached[j] !== 0 || grownFg[j] !== 0) continue;
      reached[j] = 255;
      edge.push(j);
    }
  }
  const ground = dilateMask({ width, height, data: reached }, Math.ceil(FOREGROUND_CLOSE * Math.SQRT2)).data;
  // Inside a polygon the cut decides (a keyed part keeps its ground between strands on purpose).
  for (let i = 0; i < ground.length; i++) if (ground[i] === 0 && out.data[i] === 0 && union[i] === 0) out.data[i] = 255;
  return out;
}

/** `mask` (1 = set) without its 4-connected pieces smaller than `speck` px. Returns the kept count. */
export function dropSpecks(mask: Uint8Array, width: number, speck: number): number {
  const seen = new Uint8Array(mask.length);
  let kept = 0;
  const piece: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || seen[start] === 1) continue;
    piece.length = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() ?? 0;
      piece.push(i);
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= mask.length || mask[j] !== 1 || seen[j] === 1) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (piece.length < speck) for (const i of piece) mask[i] = 0;
    else kept += piece.length;
  }
  return kept;
}

/** Layer names of the head group (`turnHead`) and of the body group (body layers and what follows them, off the head). */
export function groupsOf(rig: Rig): {
  head: ReadonlySet<string>;
  body: ReadonlySet<string>;
} {
  const head = turnHead(rig)?.members ?? new Set<string>();
  const byName = new Map(rig.layers.map((l) => [l.name, l]));
  const onBody = (name: string): boolean => {
    const seen = new Set<string>();
    for (let at = byName.get(name); at !== undefined && !seen.has(at.name); at = at.follow === undefined ? undefined : byName.get(at.follow)) {
      if (at.kind === "body") return true;
      seen.add(at.name);
    }
    return false;
  };
  return {
    head,
    body: new Set(rig.layers.filter((l) => !head.has(l.name) && onBody(l.name)).map((l) => l.name)),
  };
}

/** Per pixel, 1 where the named layers at rest have alpha >= `from` (0..255). */
export function solidOf(rig: Rig, images: Images, names: ReadonlySet<string>, from: number): Uint8Array {
  const rest = posesAt(rig, REST_DRIVE).filter((p) => names.has(p.name));
  const cov = coverage(rig, images, rest);
  const out = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) if ((cov[i] ?? 0) * 255 >= from) out[i] = 1;
  return out;
}

/**
 * Per pixel, 1 when the nearest set pixel of `head` is nearer than the nearest of `body`, else 0
 * (8-connected steps from both at once; a tie, or a pixel neither reaches, is the body's).
 */
export function nearerHead(head: Uint8Array, body: Uint8Array, width: number): Uint8Array {
  const owner = new Int8Array(head.length).fill(-1);
  let front: number[] = [];
  for (let i = 0; i < body.length; i++)
    if (body[i] === 1) {
      owner[i] = 0;
      front.push(i);
    }
  for (let i = 0; i < head.length; i++)
    if (head[i] === 1 && owner[i] === -1) {
      owner[i] = 1;
      front.push(i);
    }
  while (front.length > 0) {
    const next: number[] = [];
    // Body pixels first in every ring, so a tie goes to the body.
    for (const who of [0, 1]) {
      for (const i of front) {
        if (owner[i] !== who) continue;
        const x = i % width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= width) continue;
            const j = i + dy * width + dx;
            if (j < 0 || j >= owner.length || owner[j] !== -1) continue;
            owner[j] = who;
            next.push(j);
          }
        }
      }
    }
    front = next;
  }
  return Uint8Array.from(owner, (o) => (o === 1 ? 1 : 0));
}

/** Per pixel, the distance (px) down its column to the nearest set pixel of `mask` strictly below it; Infinity when none. */
export function distanceBelow(mask: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(mask.length).fill(Infinity);
  for (let x = 0; x < width; x++) {
    let next = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      out[i] = next === Infinity ? Infinity : next - y;
      if (mask[i] === 1) next = y;
    }
  }
  return out;
}
