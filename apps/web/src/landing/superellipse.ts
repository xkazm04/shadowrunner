// The glass of the set (landing design.md "Glass geometry"): a superellipse
// |x/a|^n + |y/b|^n = 1 about (cx, cy). Pure: points, an SVG path, and a CSS clip-path polygon in
// percentages of the plate box, so one clip scales with the plate and is shared by the picture,
// the grade, the glare and the lower third.

export interface Superellipse {
  cx: number;
  cy: number;
  /** Half-axes, > 0. */
  a: number;
  b: number;
  /** Exponent, > 0 (2 is an ellipse; the glass is 3). */
  n: number;
}

export interface Box {
  width: number;
  height: number;
}

export type Point = readonly [number, number];

/** The CRT plate's pixel space (crt-frontal). */
export const PLATE: Readonly<Box> = { width: 1200, height: 896 };

/** The frontal set's glass, in plate px. */
export const GLASS: Readonly<Superellipse> = { cx: 597, cy: 427, a: 253, b: 204, n: 3 };

const finite = (v: number) => Number.isFinite(v);

/**
 * `steps` points on the curve, starting at the rightmost point and turning once (clockwise on
 * screen, as y grows downwards), evenly spaced in the parameter t:
 * x = cx + a·sgn(cos t)·|cos t|^(2/n), y = cy + b·sgn(sin t)·|sin t|^(2/n).
 * Then |x/a|^n + |y/b|^n = cos²t + sin²t = 1.
 */
export function superellipse(shape: Superellipse, steps: number): Point[] {
  const { cx, cy, a, b, n } = shape;
  if (![cx, cy, a, b, n].every(finite) || a <= 0 || b <= 0 || n <= 0) {
    throw new RangeError(`superellipse: needs finite cx, cy and a, b, n > 0 (got ${JSON.stringify(shape)})`);
  }
  if (!Number.isInteger(steps) || steps < 4) throw new RangeError(`superellipse: steps must be an integer >= 4 (got ${steps})`);
  const e = 2 / n;
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const c = Math.cos(t);
    const s = Math.sin(t);
    points.push([cx + a * Math.sign(c) * Math.abs(c) ** e, cy + b * Math.sign(s) * Math.abs(s) ** e]);
  }
  return points;
}

/** A number with at most `digits` decimals and no trailing zeros ("12.5", "0", "-3.1416"). */
function num(v: number, digits: number): string {
  const text = v.toFixed(digits);
  const trimmed = text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  return trimmed === "-0" ? "0" : trimmed;
}

/** Closed SVG path through the points, in their own units (for a viewBox of the plate). */
export function svgPath(points: readonly Point[], digits = 3): string {
  const [first, ...rest] = points;
  if (!first) return "";
  return `M${num(first[0], digits)} ${num(first[1], digits)}${rest.map(([x, y]) => `L${num(x, digits)} ${num(y, digits)}`).join("")}Z`;
}

/**
 * CSS `polygon()` of the points as percentages of `box`, for clip-path on an element that is the
 * box (the plate) at any size. Four decimals of a percent of the 1200 px plate is under 0.001 px.
 */
export function clipPolygon(points: readonly Point[], box: Box, digits = 4): string {
  const pct = (v: number, size: number) => `${num((v / size) * 100, digits)}%`;
  return `polygon(${points.map(([x, y]) => `${pct(x, box.width)} ${pct(y, box.height)}`).join(", ")})`;
}
