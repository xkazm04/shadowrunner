// The pose's 2D transform algebra (rig-core req 4, split out of pose.ts for the 400-line cap):
// `p -> R(rot) diag(kx, ky) p + t`, composed down follow chains. Pure, internal to the package.

/** p -> R(rot) * diag(kx, ky) * p + t; uniform (kx = ky) unless a reshape stretches a part. */
export interface Sim {
  rot: number;
  kx: number;
  ky: number;
  tx: number;
  ty: number;
}
export const IDENTITY: Sim = { rot: 0, kx: 1, ky: 1, tx: 0, ty: 0 };

export function apply(s: Sim, x: number, y: number): [number, number] {
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  const cx = cos * s.kx;
  const nx = sin * s.kx;
  const cy = cos * s.ky;
  const ny = sin * s.ky;
  return [cx * x - ny * y + s.tx, nx * x + cy * y + s.ty];
}

// compose, about and turnAbout inline `apply` (perfection-pass P1: no tuple or temporary Sim per
// call); each keeps apply's operations in apply's order, so every result is bit-for-bit the same
// (the `+ 0` is apply's zero translation: it turns a -0 into +0, as before; `x * 1` is exact).

/** outer after inner (the linear part is exact when `outer` is uniform or `inner` does not turn). */
export function compose(outer: Sim, inner: Sim): Sim {
  const cos = Math.cos(outer.rot);
  const sin = Math.sin(outer.rot);
  const cx = cos * outer.kx;
  const nx = sin * outer.kx;
  const cy = cos * outer.ky;
  const ny = sin * outer.ky;
  return { rot: outer.rot + inner.rot, kx: outer.kx * inner.kx, ky: outer.ky * inner.ky, tx: cx * inner.tx - ny * inner.ty + outer.tx, ty: nx * inner.tx + cy * inner.ty + outer.ty };
}

/** p -> R(rot) diag(kx, ky) (p - a) + a. */
export function about(ax: number, ay: number, rot: number, kx: number, ky: number): Sim {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rx = cos * kx * ax - sin * ky * ay + 0;
  const ry = sin * kx * ax + cos * ky * ay + 0;
  return { rot, kx, ky, tx: ax - rx, ty: ay - ry };
}

/** The canvas-space turn by `rotation` about `[qx, qy]` followed by a move of `(dx, dy)`. */
export function turnAbout(qx: number, qy: number, rotation: number, dx: number, dy: number): Sim {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rx = cos * qx - sin * qy + 0;
  const ry = sin * qx + cos * qy + 0;
  return { rot: rotation, kx: 1, ky: 1, tx: qx + dx - rx, ty: qy + dy - ry };
}
