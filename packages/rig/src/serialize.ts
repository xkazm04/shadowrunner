// serializeRig (rig-core req 1.2, design.md "Overview"): writes a Rig as JSON with the keys in
// contract order (types.ts), optional fields omitted when undefined, and fields outside the
// contract dropped. It never writes `null`: a non-finite number (which JSON.stringify would turn
// into null) throws a RangeError instead.
import { EXPRESSION_FAMILIES } from "./control.js";
import type { ExpressionFamily, Layer, LayerPatch, LayerRegions, Motion, Palette, Rig, RigFace } from "./types.js";

function wirePalette(palette: Palette): Palette {
  return { glow: palette.glow, eye: palette.eye, rim: palette.rim, mouth: palette.mouth };
}

function wireMotion(motion: Motion): Motion {
  const { float, pulse, blink } = motion;
  return {
    ...(float === undefined
      ? {}
      : {
          float: {
            amp: [float.amp[0], float.amp[1]],
            freq: float.freq,
            ...(float.rot_deg === undefined ? {} : { rot_deg: float.rot_deg }),
            ...(float.phase === undefined ? {} : { phase: float.phase }),
          },
        }),
    ...(pulse === undefined ? {} : { pulse: { amp: pulse.amp, freq: pulse.freq, ...(pulse.phase === undefined ? {} : { phase: pulse.phase }) } }),
    ...(blink === undefined ? {} : { blink: { freq: blink.freq, ...(blink.phase === undefined ? {} : { phase: blink.phase }) } }),
  };
}

/** Families in EXPRESSION_FAMILIES order, each patch `{ file, bbox, mode }`. */
function wireVariants(variants: Partial<Record<ExpressionFamily, LayerPatch>>): Partial<Record<ExpressionFamily, LayerPatch>> {
  const out: Partial<Record<ExpressionFamily, LayerPatch>> = {};
  for (const family of EXPRESSION_FAMILIES) {
    const patch = variants[family];
    if (patch === undefined) continue;
    const [x, y, w, h] = patch.bbox;
    out[family] = { file: patch.file, bbox: [x, y, w, h], mode: patch.mode, ...(patch.socket === undefined ? {} : { socket: patch.socket }), ...(patch.narrowed === true ? { narrowed: true as const } : {}) };
  }
  return out;
}

function wireRegions(regions: LayerRegions): LayerRegions {
  return { map: regions.map, slots: regions.slots.map((slot) => ({ id: slot.id, name: slot.name, hex: slot.hex })) };
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
    ...(layer.motion === undefined ? {} : { motion: wireMotion(layer.motion) }),
    ...(layer.drop === undefined ? {} : { drop: layer.drop }),
    ...(layer.emissive === undefined ? {} : { emissive: layer.emissive }),
    ...(layer.variants === undefined ? {} : { variants: wireVariants(layer.variants) }),
    ...(layer.regions === undefined ? {} : { regions: wireRegions(layer.regions) }),
    ...(layer.socket === undefined ? {} : { socket: layer.socket }),
    ...(layer.closed === undefined ? {} : { closed: layer.closed }),
    ...(layer.tint === false ? { tint: false as const } : {}),
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
    ...(rig.mouth === undefined ? {} : { mouth: { cx: rig.mouth.cx, lineY: rig.mouth.lineY, width: rig.mouth.width, ...(rig.mouth.render === undefined ? {} : { render: rig.mouth.render }), ...(rig.mouth.cell === undefined ? {} : { cell: rig.mouth.cell }), ...(rig.mouth.lips === undefined ? {} : { lips: { left: rig.mouth.lips.left, right: rig.mouth.lips.right, upper: rig.mouth.lips.upper, lower: rig.mouth.lips.lower, ...(rig.mouth.lips.seam === undefined ? {} : { seam: rig.mouth.lips.seam }), ...(rig.mouth.lips.maw === true ? { maw: true as const } : {}) } }) } }),
    ...(rig.face === undefined ? {} : { face: JSON.parse(JSON.stringify(rig.face)) as RigFace }),
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
