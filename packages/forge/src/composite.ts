// A reference compositor for checking forged rigs by eye and in tests (task 9): the rig's layers
// drawn back to front, each moved by whole pixels and, when the pose says so, turned and scaled
// about its moved anchor (nearest pixel; cast-forge task 4: a swaying lure stalk). It is not the
// avatar renderer; it shows what the layers hold, which is what the forge is responsible for. Pure.
import type { Layer, Rig } from "@sr/rig";
import type { Rgba } from "./types.js";

export interface CompositePose {
  /** Canvas px the jaw layers move down (an open jaw; the renderer's drop is 0.06 x height). */
  jaw?: number;
  /** Canvas px per unit of layer depth moved right (head yaw parallax; may be negative). */
  parallax?: number;
  /** Per layer name, a move in canvas px that replaces the two above (e.g. from `poseLayers`). */
  offsets?: Readonly<Record<string, readonly [number, number]>>;
  /** Per layer name, a light gain multiplied into its colour (a pulse; `poseLayers` tint), clamped to 255. */
  gains?: Readonly<Record<string, number>>;
  /** Per layer name, a turn (radians, clockwise) and scale about its anchor moved by the offset (`poseLayers` rotation and scale). */
  turns?: Readonly<Record<string, LayerTurn>>;
}

export interface LayerTurn {
  rotation: number;
  scale?: readonly [x: number, y: number];
}

/**
 * The rig's layers (by z, back to front) composited source-over onto opaque black. `images` holds
 * each layer's decoded pixels by `layer.file`; a layer without one is skipped. Each layer is placed
 * at its bbox top-left rounded to whole px, moved by the pose. Returns an opaque RGBA image.
 */
export function compositeRig(rig: Pick<Rig, "width" | "height" | "layers">, images: Readonly<Record<string, Rgba>>, pose: CompositePose = {}): Rgba {
  const { width, height } = rig;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
    const image = images[layer.file];
    if (image === undefined) continue;
    const [dx, dy] = offsetOf(layer, pose);
    const gain = pose.gains?.[layer.name] ?? 1;
    const left = Math.round(layer.bbox[0]) + dx;
    const top = Math.round(layer.bbox[1]) + dy;
    const turn = pose.turns?.[layer.name];
    const blend = (tx: number, ty: number, sx: number, sy: number): void => {
      const s = (sy * image.width + sx) * 4;
      const t = (ty * width + tx) * 4;
      const a = (image.data[s + 3] ?? 0) / 255;
      if (a === 0) return;
      for (let c = 0; c < 3; c++) out[t + c] = Math.round(Math.min(255, (image.data[s + c] ?? 0) * gain) * a + (out[t + c] ?? 0) * (1 - a));
    };
    if (turn === undefined || (turn.rotation === 0 && (turn.scale ?? [1, 1]).every((k) => k === 1))) {
      for (let y = 0; y < image.height; y++) {
        const ty = top + y;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < image.width; x++) {
          const tx = left + x;
          if (tx >= 0 && tx < width) blend(tx, ty, x, y);
        }
      }
      continue;
    }
    // Turned: every canvas pixel in reach is mapped back into the layer image (nearest pixel).
    const [kx, ky] = turn.scale ?? [1, 1];
    if (kx === 0 || ky === 0) continue;
    const ax = layer.anchor[0] + dx;
    const ay = layer.anchor[1] + dy;
    const cos = Math.cos(turn.rotation);
    const sin = Math.sin(turn.rotation);
    const reach = Math.hypot(image.width, image.height) * Math.max(1, Math.abs(kx), Math.abs(ky)) + Math.hypot(ax - left, ay - top);
    for (let ty = Math.max(0, Math.floor(ay - reach)); ty < Math.min(height, Math.ceil(ay + reach)); ty++) {
      for (let tx = Math.max(0, Math.floor(ax - reach)); tx < Math.min(width, Math.ceil(ax + reach)); tx++) {
        const px = tx + 0.5 - ax;
        const py = ty + 0.5 - ay;
        const sx = Math.floor(ax + (cos * px + sin * py) / kx - left);
        const sy = Math.floor(ay + (-sin * px + cos * py) / ky - top);
        if (sx >= 0 && sx < image.width && sy >= 0 && sy < image.height) blend(tx, ty, sx, sy);
      }
    }
  }
  return { width, height, data: out };
}

function offsetOf(layer: Layer, pose: CompositePose): [number, number] {
  const given = pose.offsets?.[layer.name];
  if (given !== undefined) return [Math.round(given[0]), Math.round(given[1])];
  const dx = Math.round((pose.parallax ?? 0) * (layer.depth ?? 0));
  return [dx, layer.kind === "jaw" ? Math.round(pose.jaw ?? 0) : 0];
}
