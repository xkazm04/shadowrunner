// Poses and coverage for the coverage check (perfection-pass task 16; cover.ts has the rules): the
// rig's limits as drives, each layer's pose as a map between canvas and image px (as `compositeRig`
// draws it), and the composited alpha of the posed layers. Pure.
import { EMOTION_TABLE, GESTURE_DURATION_S, PITCH_LIMIT_DEG, YAW_LIMIT_DEG, type Drive, type Emotion, type Gesture, type LayerPose, type Look, type Rig, defaultLook, poseLayers } from "@sr/rig";
import type { Rgba } from "./types.js";

/** The backdrop layer's name (assemble.ts BACKGROUND_LAYER; repeated here so assemble.ts can import this module). */
export const BACKDROP = "background";

export type Images = Readonly<Record<string, Rgba>>;

/** One drive and look within the rig's limits. */
export interface LimitPose {
  name: string;
  drive: Drive;
  emotion: Emotion;
}

const strongestTilt = (sign: 1 | -1): Emotion =>
  (Object.keys(EMOTION_TABLE) as Emotion[]).reduce((best, e) => (sign * EMOTION_TABLE[e].headTilt > sign * EMOTION_TABLE[best].headTilt ? e : best), "neutral");

/**
 * The rig's limits: yaw at 0 and +-YAW_LIMIT_DEG, pitch at 0 and +-PITCH_LIMIT_DEG, each with no
 * gesture and with the tilt, lean_in and recoil gestures at their peak, at the neutral mood and at
 * the moods with the strongest head roll each way (the roll adds to the tilt gesture's). Still (no
 * idle float), default face profile.
 */
export function limitPoses(): LimitPose[] {
  const out: LimitPose[] = [];
  const emotions = [...new Set<Emotion>(["neutral", strongestTilt(1), strongestTilt(-1)])];
  const gestures: (Gesture | undefined)[] = [undefined, "tilt", "lean_in", "recoil"];
  for (const emotion of emotions) {
    for (const gesture of gestures) {
      for (const headYaw of [0, -YAW_LIMIT_DEG, YAW_LIMIT_DEG]) {
        for (const headPitch of [0, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG]) {
          const t = gesture === undefined ? 0 : GESTURE_DURATION_S / 2;
          const drive: Drive = {
            t,
            headYaw,
            headPitch,
            jawOpen: 0,
            blink: 0,
            still: true,
            ...(gesture === undefined ? {} : { gesture: { name: gesture, startedAt: 0 } }),
          };
          out.push({
            name: `${emotion} ${gesture ?? "-"} yaw ${headYaw} pitch ${headPitch}`,
            drive,
            emotion,
          });
        }
      }
    }
  }
  return out;
}

/** The rest drive: facing front, still. */
export const REST_DRIVE: Drive = {
  t: 0,
  headYaw: 0,
  headPitch: 0,
  jawOpen: 0,
  blink: 0,
  still: true,
};

/** The rig's default look at `emotion` with the backdrop hidden (the cutout and the stage). */
export function cutoutLook(rig: Rig, emotion: Emotion = "neutral"): Look {
  const look = defaultLook(rig);
  return {
    ...look,
    emotion,
    hidden: [...new Set([...look.hidden, BACKDROP])].sort(),
  };
}

/** The layers' poses at `drive` with the backdrop hidden. */
export const posesAt = (rig: Rig, drive: Drive, emotion: Emotion = "neutral"): LayerPose[] => poseLayers(rig, cutoutLook(rig, emotion), drive);

/** A layer pose as a map from canvas px to the layer's image px and back. */
export interface Placed {
  image: Rgba;
  /** Canvas point (px, continuous) -> image px (continuous); NaN when the pose has a zero scale. */
  toImage(qx: number, qy: number): [number, number];
  /** Image point (continuous) -> canvas point. */
  toCanvas(sx: number, sy: number): [number, number];
  opacity: number;
}

/** The layer's pose as `compositeRig` draws it: moved bbox, turned and scaled about the moved anchor. */
export function place(rig: Rig, images: Images, pose: LayerPose): Placed | undefined {
  const layer = rig.layers.find((l) => l.name === pose.name);
  const image = layer === undefined ? undefined : images[layer.file];
  if (layer === undefined || image === undefined) return undefined;
  const [kx, ky] = pose.scale;
  const ax = layer.anchor[0] + pose.x - layer.bbox[0];
  const ay = layer.anchor[1] + pose.y - layer.bbox[1];
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  return {
    image,
    opacity: pose.opacity,
    toImage(qx, qy) {
      const px = qx - ax;
      const py = qy - ay;
      return [ax + (cos * px + sin * py) / kx - pose.x, ay + (-sin * px + cos * py) / ky - pose.y];
    },
    toCanvas(sx, sy) {
      const dx = (sx + pose.x - ax) * kx;
      const dy = (sy + pose.y - ay) * ky;
      return [ax + cos * dx - sin * dy, ay + sin * dx + cos * dy];
    },
  };
}

/** Alpha 0..1 of the placed layer at canvas pixel (x, y) (nearest image pixel). */
export function alphaAt(p: Placed, x: number, y: number): number {
  const [sx, sy] = p.toImage(x + 0.5, y + 0.5);
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  if (!(ix >= 0 && iy >= 0 && ix < p.image.width && iy < p.image.height)) return 0;
  return ((p.image.data[(iy * p.image.width + ix) * 4 + 3] ?? 0) / 255) * p.opacity;
}

/**
 * Composited alpha (0..1) of the posed layers (the backdrop excluded) on every canvas pixel, or only
 * where `region` is non-zero (others stay 0).
 */
export function coverage(rig: Rig, images: Images, poses: readonly LayerPose[], region?: Uint8Array): Float32Array {
  const { width, height } = rig;
  const cov = new Float32Array(width * height);
  let cells: number[] | undefined;
  if (region !== undefined) {
    cells = [];
    for (let i = 0; i < region.length; i++) if (region[i] !== 0) cells.push(i);
  }
  for (const pose of poses) {
    if (pose.name === BACKDROP) continue;
    const p = place(rig, images, pose);
    if (p === undefined || !Number.isFinite(p.toImage(0, 0)[0])) continue;
    const corners = [p.toCanvas(0, 0), p.toCanvas(p.image.width, 0), p.toCanvas(0, p.image.height), p.toCanvas(p.image.width, p.image.height)];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1);
    const x1 = Math.min(width, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1);
    const y1 = Math.min(height, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
    if (cells !== undefined) {
      // A sparse region (the neck): visit its pixels, not the layer's box.
      for (const i of cells) {
        const x = i % width;
        const y = (i - x) / width;
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        const a = alphaAt(p, x, y);
        if (a > 0) cov[i] = (cov[i] ?? 0) + a * (1 - (cov[i] ?? 0));
      }
      continue;
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        if (region !== undefined && region[i] === 0) continue;
        const a = alphaAt(p, x, y);
        if (a > 0) cov[i] = (cov[i] ?? 0) + a * (1 - (cov[i] ?? 0));
      }
    }
  }
  return cov;
}
