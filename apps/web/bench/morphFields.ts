// The synthetic rig's moving keys (morphSynth.ts; companion-lanes round 2): each key's colour, its
// forward field F (flow cell, layer frame), its back field G and reveal r (back cell, key frame), in
// canvas px relative to the key's bbox (u, v at pixel centres). F and G fade with the coverage.
// - `shift`: the checker moved SHIFT px right; F only (no back cell): the round-1 path.
// - `big`: the head moved BIG px right; F = BIG, G = -BIG: a field two fixed-point steps could not invert.
// - `stretch`: a vertical stretch about the box's middle row that opens a gap of half height
//   STRETCH (tapering to none across the box: full in the left half, gone from 3/4 on), filled with
//   INTERIOR (new surface, r = 1); where the stretch is gone the key is the head inverted (no
//   motion, no reveal), so a plain cross-fade can be read there.

/** Per-pixel coverage of a w x h box: 1 inside, feathered to 0 over FEATHER px at the edge. */
export const FEATHER = 12;
export const coverageAt = (u: number, v: number, w: number, h: number): number => Math.min(1, Math.max(0, Math.min(u + 0.5, v + 0.5, w - u - 0.5, h - v - 0.5) / FEATHER));

export const SHIFT = 4;
export const BIG = 42;
export const STRETCH = 16;
export const INTERIOR: readonly [number, number, number] = [120, 20, 40];

type Rgb = [number, number, number];
type Head = (x: number, y: number) => Rgb;

export interface Moving {
  flowMax: number;
  /** Colour at the bbox px (u, v) (integers). */
  colour(head: Head, u: number, v: number): Rgb;
  /** Forward field at bbox point (u, v), canvas px. */
  f(u: number, v: number): [number, number];
  /** Back field and reveal at bbox point (u, v); absent: no back cell. */
  g?(u: number, v: number): [number, number];
  r?(u: number, v: number): number;
}

/** The fields of a key whose box is `w` x `h` at `x0`, `y0`. */
export function moving(id: string, [x0, y0, w, h]: readonly [number, number, number, number]): Moving | undefined {
  const cov = (u: number, v: number): number => coverageAt(u - 0.5, v - 0.5, w, h);
  if (id === "shift") return { flowMax: SHIFT, colour: (head, u, v) => head(x0 + u - SHIFT, y0 + v), f: (u, v) => [SHIFT * cov(u, v), 0] };
  if (id === "big") {
    return { flowMax: BIG, colour: (head, u, v) => head(x0 + u - BIG, y0 + v), f: (u, v) => [BIG * cov(u, v), 0], g: (u, v) => [-BIG * cov(u, v), 0], r: () => 0 };
  }
  if (id !== "stretch") return undefined;
  const mid = h / 2;
  const across = (u: number): number => (u < w / 2 ? 1 : u < (3 * w) / 4 ? ((3 * w) / 4 - u) / (w / 4) : 0);
  const gap = (u: number): number => STRETCH * across(u);
  /** For a key point: its distance from the middle row, its side (+1 below), and how far its feature has moved. */
  const back = (u: number, v: number): { dist: number; side: number; t: number; gap: number } => {
    const dist = Math.abs(v - mid);
    const g = gap(u);
    return { dist, side: v < mid ? -1 : 1, t: Math.min(1, Math.max(0, (mid - dist) / (mid - g))), gap: g };
  };
  return {
    flowMax: STRETCH,
    colour: (head, u, v) => {
      const k = back(u + 0.5, v + 0.5);
      if (k.dist < k.gap) return [INTERIOR[0], INTERIOR[1], INTERIOR[2]];
      const own = head(x0 + u, Math.floor(y0 + v + 0.5 - k.side * k.gap * k.t));
      const a = across(u + 0.5);
      return [0, 1, 2].map((c) => Math.round((own[c] ?? 0) * a + (255 - (own[c] ?? 0)) * (1 - a))) as Rgb;
    },
    // A layer point a px from the middle row lands at a (1 - g/mid) + g: it moves g (1 - a/mid) away.
    f: (u, v) => [0, (v < mid ? -1 : 1) * gap(u) * (1 - Math.abs(v - mid) / mid) * cov(u, v)],
    g: (u, v) => {
      const k = back(u, v);
      return [0, (k.dist < k.gap ? mid - v : -k.side * k.gap * k.t) * cov(u, v)];
    },
    r: (u, v) => {
      const k = back(u, v);
      return Math.min(1, Math.max(0, k.gap - k.dist + 0.5));
    },
  };
}
