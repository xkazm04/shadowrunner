// A reference compositor for checking forged rigs by eye and in tests (task 9): the rig's layers
// drawn back to front, each moved by whole pixels, with no rotation or scale. It is not the avatar
// renderer; it shows what the layers hold, which is what the forge is responsible for. Pure.
import type { Layer, Rig } from "@sr/rig";
import type { Rgba } from "./types.js";

export interface CompositePose {
  /** Canvas px the jaw layers move down (an open jaw; the renderer's drop is 0.06 x height). */
  jaw?: number;
  /** Canvas px per unit of layer depth moved right (head yaw parallax; may be negative). */
  parallax?: number;
  /** Per layer name, a move in canvas px that replaces the two above (e.g. from `poseLayers`). */
  offsets?: Readonly<Record<string, readonly [number, number]>>;
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
    const left = Math.round(layer.bbox[0]) + dx;
    const top = Math.round(layer.bbox[1]) + dy;
    for (let y = 0; y < image.height; y++) {
      const ty = top + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const tx = left + x;
        if (tx < 0 || tx >= width) continue;
        const s = (y * image.width + x) * 4;
        const t = (ty * width + tx) * 4;
        const a = (image.data[s + 3] ?? 0) / 255;
        if (a === 0) continue;
        for (let c = 0; c < 3; c++) out[t + c] = Math.round((image.data[s + c] ?? 0) * a + (out[t + c] ?? 0) * (1 - a));
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
