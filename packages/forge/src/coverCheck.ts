// The coverage check (perfection-pass task 16, requirement 16.2; cover.ts has the definitions). With
// the backdrop hidden, (a) at rest every foreground pixel of the portrait is covered by the layers,
// and (b) at every pose within the rig's limits (`limitPoses`) the neck stays covered: the pixels the
// head group covers at rest with the body below them in the same column, within the neck reach (how
// far the head group moves against the body at those limits, measured with the rig's own pose math),
// carried with the body to where the pose puts it (the body's own outline moving over the ground is
// not a gap; the head moving off the body's neck is). Pieces under COVER_SPECK px are edge crumbs and do not count. Pure.
import type { LayerPose, Rig } from "@sr/rig";
import {
  COVERED,
  COVER_SPECK,
  type Images,
  type Placed,
  REACH_MARGIN,
  REACH_MAX,
  REST_DRIVE,
  SOLID,
  alphaAt,
  convexHull,
  coverage,
  distanceBelow,
  dropSpecks,
  foregroundOf,
  groupsOf,
  limitPoses,
  place,
  posesAt,
  solidOf,
} from "./cover.js";
import type { NamedPart, Part, Rgba } from "./types.js";

export interface Neck {
  /** Px: the most any neck pixel of the head group moves against the body at the limits, plus REACH_MARGIN; capped at REACH_MAX. */
  reach: number;
  /** Px: the most the body itself moves there (its parallax and breath). */
  bodyShift: number;
  /** 1 on the neck: head group solid at rest, the visible body (no head pixel over it) below within `reach` in the same column. */
  mask: Uint8Array;
  /** Per pixel, the distance down to the visible body (cover.ts `distanceBelow`). */
  below: Float32Array;
  /** 1 where the head group has any alpha at rest. */
  headAny: Uint8Array;
  /** The body group's root layer, which carries the neck. */
  root?: string;
}

const byName = (poses: readonly LayerPose[]): Map<string, LayerPose> => new Map(poses.map((p) => [p.name, p]));

/** The neck (see Neck) of a rig with its layer images; an empty neck when the rig has no head or no body. */
export function neckOf(rig: Rig, images: Images): Neck {
  const { width, height } = rig;
  const { head, body } = groupsOf(rig);
  const headSolid = solidOf(rig, images, head, SOLID);
  const headAny = solidOf(rig, images, head, 1);
  // The body where no head pixel lies over it at all, so the body added under the head (coverFix
  // step 3) never counts as visible body and the neck does not climb on its own addition.
  const bodyVisible = solidOf(rig, images, body, SOLID).map((b, i) => (b === 1 && headAny[i] === 0 ? 1 : 0));
  const below = distanceBelow(bodyVisible, width, height);
  const root = rig.layers.find((l) => l.kind === "body" && l.follow === undefined && body.has(l.name));
  const empty = {
    reach: 0,
    bodyShift: 0,
    mask: new Uint8Array(width * height),
    below,
    headAny,
  };
  if (head.size === 0 || root === undefined) return empty;

  const candidates: number[] = [];
  for (let i = 0; i < headSolid.length; i++) if (headSolid[i] === 1 && (below[i] ?? Infinity) <= REACH_MAX) candidates.push(i);
  if (candidates.length === 0) return empty;
  const rest = byName(posesAt(rig, REST_DRIVE));
  const placedAt = (poses: Map<string, LayerPose>, name: string): Placed | undefined => {
    const pose = poses.get(name);
    return pose === undefined ? undefined : place(rig, images, pose);
  };
  const bodyRest = placedAt(rest, root.name);
  if (bodyRest === undefined) return empty;
  // Every map here is affine, so the most a set of points moves is reached on its convex hull: per
  // head layer, the hull of the candidates it holds solid; for the body, the hull of all of them.
  const centre = (i: number): [number, number] => [(i % width) + 0.5, Math.floor(i / width) + 0.5];
  const headLayers = [...head].flatMap((name) => {
    const at = placedAt(rest, name);
    if (at === undefined) return [];
    const held = candidates.filter((i) => alphaAt(at, i % width, Math.floor(i / width)) * 255 >= SOLID).map(centre);
    return held.length === 0 ? [] : [{ name, rest: at, hull: convexHull(held) }];
  });
  const all = convexHull(candidates.map(centre));

  let most = 0;
  let bodyShift = 0;
  for (const limit of limitPoses()) {
    const posed = byName(posesAt(rig, limit.drive, limit.emotion));
    const bodyNow = placedAt(posed, root.name);
    if (bodyNow === undefined) continue;
    const bodyAt = (qx: number, qy: number): [number, number] => bodyNow.toCanvas(...bodyRest.toImage(qx, qy));
    for (const [qx, qy] of all) {
      const [bx, by] = bodyAt(qx, qy);
      bodyShift = Math.max(bodyShift, Math.hypot(bx - qx, by - qy));
    }
    for (const h of headLayers) {
      const now = placedAt(posed, h.name);
      if (now === undefined) continue;
      for (const [qx, qy] of h.hull) {
        const [hx, hy] = now.toCanvas(...h.rest.toImage(qx, qy));
        const [bx, by] = bodyAt(qx, qy);
        most = Math.max(most, Math.hypot(hx - bx, hy - by));
      }
    }
  }
  const reach = Math.min(REACH_MAX, Math.ceil(most) + REACH_MARGIN);
  const mask = new Uint8Array(width * height);
  for (const i of candidates) if ((below[i] ?? Infinity) <= reach) mask[i] = 1;
  return { reach, bodyShift, mask, below, headAny, root: root.name };
}

export interface CoverReport {
  /** Pixels of the portrait's foreground at full key (255). */
  foreground: number;
  /** Of those, uncovered at rest (composited alpha < COVERED), pieces under COVER_SPECK px left out. */
  uncovered: number;
  /** 1 on the uncovered pixels counted above. */
  uncoveredMask: Uint8Array;
  /** The neck reach (px) and size (px). */
  reach: number;
  neck: number;
  /** Neck pixels uncovered at the worst limit pose (specks left out), and that pose. */
  neckGaps: number;
  worstPose?: string;
  /** 1 on the neck pixels uncovered at the worst pose. */
  neckGapMask: Uint8Array;
}

/** Whether a report passes requirement 16.2: nothing uncovered at rest, nothing on the neck at any limit pose. */
export const covers = (report: CoverReport): boolean => report.uncovered === 0 && report.neckGaps === 0;

/** The coverage check (see the header) of a rig with its layer images, against its portrait and recorded parts. */
export function coverReport(rig: Rig, images: Images, portrait: Rgba, parts: readonly (Part | NamedPart)[]): CoverReport {
  const { width, height } = rig;
  if (portrait.width !== width || portrait.height !== height) throw new RangeError(`coverReport: portrait ${portrait.width}x${portrait.height} does not match rig ${width}x${height}`);
  const fg = foregroundOf(portrait, parts).data;
  const cov = coverage(rig, images, posesAt(rig, REST_DRIVE));
  const uncoveredMask = new Uint8Array(width * height);
  let foreground = 0;
  for (let i = 0; i < fg.length; i++) {
    if (fg[i] !== 255) continue;
    foreground++;
    if ((cov[i] ?? 0) < COVERED) uncoveredMask[i] = 1;
  }
  const uncovered = dropSpecks(uncoveredMask, width, COVER_SPECK);

  const neck = neckOf(rig, images);
  let neckGaps = 0;
  let worstPose: string | undefined;
  let neckGapMask = new Uint8Array(width * height);
  const bodyRest = neck.root === undefined ? undefined : posesAt(rig, REST_DRIVE).find((p) => p.name === neck.root);
  const from = bodyRest === undefined ? undefined : place(rig, images, bodyRest);
  for (const limit of limitPoses()) {
    if (from === undefined) break;
    const poses = posesAt(rig, limit.drive, limit.emotion);
    const bodyNow = poses.find((p) => p.name === neck.root);
    const to = bodyNow === undefined ? undefined : place(rig, images, bodyNow);
    if (to === undefined) continue;
    const carried = new Uint8Array(width * height);
    for (let i = 0; i < neck.mask.length; i++) {
      if (neck.mask[i] !== 1) continue;
      const x = i % width;
      const [cx, cy] = to.toCanvas(...from.toImage(x + 0.5, (i - x) / width + 0.5));
      const tx = Math.floor(cx);
      const ty = Math.floor(cy);
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) carried[ty * width + tx] = 1;
    }
    const at = coverage(rig, images, poses, carried);
    const gaps = new Uint8Array(width * height);
    for (let i = 0; i < gaps.length; i++) if (carried[i] === 1 && (at[i] ?? 0) < COVERED) gaps[i] = 1;
    const kept = dropSpecks(gaps, width, COVER_SPECK);
    if (kept > neckGaps) {
      neckGaps = kept;
      worstPose = limit.name;
      neckGapMask = gaps;
    }
  }
  const neckSize = neck.mask.reduce((n, v) => n + v, 0);
  return {
    foreground,
    uncovered,
    uncoveredMask,
    reach: neck.reach,
    neck: neckSize,
    neckGaps,
    ...(worstPose === undefined ? {} : { worstPose }),
    neckGapMask,
  };
}
