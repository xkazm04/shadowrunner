// Pixel analysis for decomposing a cast portrait (cast-forge design.md "How a character is
// decomposed", step 2: measure, do not guess). Plain arrays, no dependencies: a mask is
// { width, height, data: Uint8Array } with 1 inside. Images are the forge's Rgba.
// Typical use: a mask from a measurement (the edit difference, a colour, the figure against the
// ground, a box), cleaned (close, fill holes, keep the biggest component), then `polygonOf` traces
// its outline and simplifies it to <= 60 points, and `toPart` writes a v2 NamedPart.

export const mask = (width, height) => ({ width, height, data: new Uint8Array(width * height) });
export const luma = (img, i) => 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];

/** Area-average resize (a downscale such as 1254 -> 1024 px keeps every source pixel's weight). */
export function resize(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      const acc = [0, 0, 0, 0];
      let total = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const w = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          const at = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += w * img.data[at + c];
          total += w;
        }
      }
      for (let c = 0; c < 4; c++) out[(y * width + x) * 4 + c] = Math.round(acc[c] / total);
    }
  }
  return { width, height, data: out };
}

/** 1 where `test(i, x, y)` holds. */
export function where(width, height, test) {
  const m = mask(width, height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = test(i, i % width, Math.floor(i / width)) ? 1 : 0;
  return m;
}

/** Mean absolute RGB difference of two same-size images above `t` (0..255): what an edit removed. */
export const diffMask = (a, b, t) =>
  where(a.width, a.height, (i) => (Math.abs(a.data[i * 4] - b.data[i * 4]) + Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) + Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2])) / 3 > t);

/** The figure against the near-black ground: luma above `t`. */
export const figureMask = (img, t = 24) => where(img.width, img.height, (i) => luma(img, i) > t);

export const and = (a, b) => ({ ...a, data: a.data.map((v, i) => v & b.data[i]) });
export const or = (a, b) => ({ ...a, data: a.data.map((v, i) => v | b.data[i]) });
export const minus = (a, b) => ({ ...a, data: a.data.map((v, i) => (b.data[i] ? 0 : v)) });
/** Keep only [x0, y0, x1, y1) of the mask. */
export const clip = (m, [x0, y0, x1, y1]) => ({ ...m, data: m.data.map((v, i) => (i % m.width >= x0 && i % m.width < x1 && Math.floor(i / m.width) >= y0 && Math.floor(i / m.width) < y1 ? v : 0)) });

/** Disc dilation (r > 0) or erosion (r < 0) by |r| px. */
export function grow(m, r) {
  if (r === 0) return m;
  const { width, height } = m;
  const k = Math.abs(r);
  const want = r > 0 ? 1 : 0;
  const out = { width, height, data: m.data.slice() };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (m.data[y * width + x] === want) continue;
      search: for (let dy = -k; dy <= k; dy++) {
        for (let dx = -k; dx <= k; dx++) {
          if (dx * dx + dy * dy > k * k) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          if (m.data[yy * width + xx] === want) {
            out.data[y * width + x] = want;
            break search;
          }
        }
      }
    }
  }
  return out;
}

export const close = (m, r) => grow(grow(m, r), -r);
export const open = (m, r) => grow(grow(m, -r), r);

/** Labels of 4-connected components: { labels: Int32Array (0 = outside), sizes: [0, n1, n2, ...] }. */
export function components(m) {
  const { width, height } = m;
  const labels = new Int32Array(width * height);
  const sizes = [0];
  const stack = [];
  for (let i = 0; i < labels.length; i++) {
    if (!m.data[i] || labels[i]) continue;
    const label = sizes.length;
    let n = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length > 0) {
      const j = stack.pop();
      n++;
      const x = j % width;
      for (const k of [x > 0 ? j - 1 : -1, x < width - 1 ? j + 1 : -1, j - width, j + width]) {
        if (k < 0 || k >= labels.length || !m.data[k] || labels[k]) continue;
        labels[k] = label;
        stack.push(k);
      }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

/** The components of at least `min` px (default: only the biggest). */
export function keepBig(m, min) {
  const { labels, sizes } = components(m);
  const biggest = Math.max(0, ...sizes.slice(1));
  const floor = min ?? biggest;
  return { ...m, data: m.data.map((_, i) => (labels[i] && sizes[labels[i]] >= floor ? 1 : 0)) };
}

/** Holes (background not connected to the border) filled. */
export function fillHoles(m) {
  const outside = where(m.width, m.height, (i) => !m.data[i]);
  const { labels } = components(outside);
  const border = new Set();
  for (let x = 0; x < m.width; x++) border.add(labels[x]).add(labels[(m.height - 1) * m.width + x]);
  for (let y = 0; y < m.height; y++) border.add(labels[y * m.width]).add(labels[y * m.width + m.width - 1]);
  return { ...m, data: m.data.map((v, i) => (v || !border.has(labels[i]) ? 1 : 0)) };
}

/** Outer contour of the biggest component (Moore neighbour tracing), [x, y] pixel corners clockwise. */
export function contour(m) {
  const big = keepBig(m);
  const { width, height } = big;
  const at = (x, y) => x >= 0 && y >= 0 && x < width && y < height && big.data[y * width + x] === 1;
  let start = -1;
  for (let i = 0; i < big.data.length && start < 0; i++) if (big.data[i]) start = i;
  if (start < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % width;
  const sy = Math.floor(start / width);
  const out = [[sx, sy]];
  let [x, y] = [sx, sy];
  let d = 6; // came from above-left scan order: start looking up
  for (let guard = 0; guard < 4 * width * height; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8;
      const [dx, dy] = dirs[nd];
      if (at(x + dx, y + dy)) {
        x += dx;
        y += dy;
        d = nd;
        found = true;
        break;
      }
    }
    if (!found || (x === sx && y === sy)) break;
    out.push([x, y]);
  }
  return out.map(([px, py]) => [px + 0.5, py + 0.5]);
}

function rdp(points, eps) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dist = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (dist > worst) [worst, at] = [dist, i];
  }
  if (worst <= eps) return [a, b];
  return [...rdp(points.slice(0, at + 1), eps).slice(0, -1), ...rdp(points.slice(at), eps)];
}

/** Closed contour simplified (Ramer-Douglas-Peucker, tolerance raised until it fits) to <= maxPoints. */
export function simplify(points, maxPoints = 60, eps = 0.75) {
  if (points.length <= 3) return points;
  // Split the loop at its farthest point from the start so both halves are open polylines.
  let far = 0;
  points.forEach((p, i) => {
    if (Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > Math.hypot(points[far][0] - points[0][0], points[far][1] - points[0][1])) far = i;
  });
  for (let e = eps; ; e *= 1.25) {
    const out = [...rdp(points.slice(0, far + 1), e).slice(0, -1), ...rdp([...points.slice(far), points[0]], e).slice(0, -1)];
    if (out.length <= maxPoints) return out;
  }
}

/** Mask -> simplified outline polygon ([x, y] canvas px). */
export const polygonOf = (m, maxPoints = 60) => simplify(contour(m), maxPoints);

/** A v2 NamedPart from a canvas polygon: [y, x] in 0..1000 integers, box_2d from the points. */
export function toPart(name, role, polygon, width, height, extra = {}) {
  const q = (v, n) => Math.max(0, Math.min(1000, Math.round((v * 1000) / n)));
  const poly = polygon.map(([x, y]) => [q(y, height), q(x, width)]);
  const ys = poly.map((p) => p[0]);
  const xs = poly.map((p) => p[1]);
  return { name, role, box_2d: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)], poly, ...extra };
}

/**
 * Per column x in [x0, x1), the row in [yLo(x), yHi(x)) where luma is lowest ("min") or where it
 * drops most going down ("edge"): a lip line, a chin line, a band's lower rim.
 */
export function profile(img, x0, x1, yLo, yHi, mode = "min") {
  const out = [];
  for (let x = x0; x < x1; x++) {
    let best = Infinity;
    let at = yLo(x);
    for (let y = yLo(x); y < yHi(x); y++) {
      const v = mode === "min" ? luma(img, y * img.width + x) : luma(img, (y + 2) * img.width + x) - luma(img, (y - 2) * img.width + x);
      if (v < best) [best, at] = [v, y];
    }
    out.push([x, at]);
  }
  return out;
}

/** 1 inside a closed polygon of [x, y] points (even-odd, pixel centres). */
export function polyMask(width, height, polygon) {
  const m = mask(width, height);
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(width, Math.ceil(xs[k + 1] - 0.5)); x++) m.data[y * width + x] = 1;
    }
  }
  return m;
}

/** Convex hull (monotone chain) of the mask's pixel centres, [x, y] clockwise on the y-down canvas. */
export function hull(m) {
  const pts = [];
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) pts.push([(i % m.width) + 0.5, Math.floor(i / m.width) + 0.5]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return pts.length < 3 ? pts : [...half(pts), ...half([...pts].reverse())];
}

/**
 * Least-squares y = a + b x + c x^2 through [x, y] points, refitted twice without the points more
 * than `tol` px off: a smooth line through a noisy profile (a chin on faceted shading).
 */
export function fitQuadratic(points, tol = 4) {
  let use = points;
  let f = () => 0;
  for (let round = 0; round < 3; round++) {
    const mx = use.reduce((s, p) => s + p[0], 0) / use.length;
    const S = [0, 0, 0, 0, 0];
    const T = [0, 0, 0];
    for (const [x0, y] of use) {
      const x = x0 - mx;
      for (let k = 0; k < 5; k++) S[k] += x ** k;
      for (let k = 0; k < 3; k++) T[k] += y * x ** k;
    }
    // Solve the 3x3 normal equations by Cramer's rule.
    const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
    const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const D = det(M);
    const coef = [0, 1, 2].map((c) => det(M.map((row, r) => row.map((v, k) => (k === c ? T[r] : v)))) / D);
    f = (x) => coef[0] + coef[1] * (x - mx) + coef[2] * (x - mx) ** 2;
    const kept = points.filter(([x, y]) => Math.abs(f(x) - y) <= tol);
    if (kept.length < 3) break;
    use = kept;
  }
  return f;
}

/**
 * The mask grown `r` px onto the ground only (where `figure` is 0). Trace this for a part whose
 * edge meets the ground: a simplified polygon's chords then stay outside the silhouette's rim light
 * instead of cutting inside it (a cut-inside rim stays on the static background as a ghost line
 * when the part moves). Ground taken in is near-black and lies over near-black, so it never shows.
 */
export const ontoGround = (m, figure, r) => or(m, minus(grow(m, r), figure));

/** Pixels of `m`, its 1 px rim aside (a contour runs through rim pixel centres), the polygon misses. */
export function uncovered(m, polygon) {
  const p = polyMask(m.width, m.height, polygon);
  const inner = grow(m, -1);
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (inner.data[i] && !p.data[i]) n++;
  return n;
}
