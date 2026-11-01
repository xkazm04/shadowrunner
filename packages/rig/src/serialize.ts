// serializeRig (rig-core req 1.2, design.md "Overview"): writes a Rig as JSON with the keys in
// contract order (types.ts), optional fields omitted when undefined, and fields outside the
// contract dropped. It never writes `null`: a non-finite number (which JSON.stringify would turn
// into null) throws a RangeError instead.
import type { Layer, Palette, Rig } from "./types.js";

function wirePalette(palette: Palette): Palette {
  return { glow: palette.glow, eye: palette.eye, rim: palette.rim, mouth: palette.mouth };
}

function wireLayer(layer: Layer): Layer {
  const [x, y, w, h] = layer.bbox;
  const [ax, ay] = layer.anchor;
  return {
    name: layer.name,
    z: layer.z,
    kind: layer.kind,
    file: layer.file,
    bbox: [x, y, w, h],
    anchor: [ax, ay],
    ...(layer.follow === undefined ? {} : { follow: layer.follow }),
    ...(layer.depth === undefined ? {} : { depth: layer.depth }),
    ...(layer.visible === undefined ? {} : { visible: layer.visible }),
  };
}

function wireRig(rig: Rig): Rig {
  return {
    version: rig.version,
    id: rig.id,
    name: rig.name,
    width: rig.width,
    height: rig.height,
    source: rig.source,
    ...(rig.fictional === undefined ? {} : { fictional: rig.fictional }),
    palette: wirePalette(rig.palette),
    layers: rig.layers.map(wireLayer),
  };
}

function finiteOnly(key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`serializeRig: "${key}" is ${String(value)}; JSON would write it as null`);
  }
  return value;
}

/** Rig -> JSON text (2-space indent, no trailing newline). Same rig in, same text out. */
export function serializeRig(rig: Rig): string {
  return JSON.stringify(wireRig(rig), finiteOnly, 2);
}
