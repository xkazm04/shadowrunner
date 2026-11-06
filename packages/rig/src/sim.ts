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
  const [cx, nx, cy, ny] = [cos * s.kx, sin * s.kx, cos * s.ky, sin * s.ky];
  return [cx * x - ny * y + s.tx, nx * x + cy * y + s.ty];
}

/** outer after inner (the linear part is exact when `outer` is uniform or `inner` does not turn). */
export function compose(outer: Sim, inner: Sim): Sim {
  const [tx, ty] = apply(outer, inner.tx, inner.ty);
  return { rot: outer.rot + inner.rot, kx: outer.kx * inner.kx, ky: outer.ky * inner.ky, tx, ty };
}

/** p -> R(rot) diag(kx, ky) (p - a) + a. */
export function about(ax: number, ay: number, rot: number, kx: number, ky: number): Sim {
  const [rx, ry] = apply({ rot, kx, ky, tx: 0, ty: 0 }, ax, ay);
  return { rot, kx, ky, tx: ax - rx, ty: ay - ry };
}

/** The canvas-space turn by `rotation` about `[qx, qy]` followed by a move of `(dx, dy)`. */
export function turnAbout(qx: number, qy: number, rotation: number, dx: number, dy: number): Sim {
  const [rx, ry] = apply({ rot: rotation, kx: 1, ky: 1, tx: 0, ty: 0 }, qx, qy);
  return { rot: rotation, kx: 1, ky: 1, tx: qx + dx - rx, ty: qy + dy - ry };
}
