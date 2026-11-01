// Assembly (forge-pipeline requirement 6; task 5): parts + cut layers -> a Rig v1 that
// validateRig accepts, plus the PNG bytes behind each layer file. Pure: no network, no clock.
import { DEFAULT_DEPTH, type Layer, type LayerKind, RIG_VERSION, type Result, type Rig, type RigError, validateRig } from "@sr/rig";
import { CUT_ORDER, type CutPart } from "./cut.js";
import { encodePng } from "./image.js";
import { rasterizeMask } from "./mask.js";
import { backgroundOf } from "./background.js";
import { samplePalette, type PaletteWarning } from "./palette.js";
import { PART_KIND, toCanvas } from "./parts.js";
import type { Part, PartName, Rgba } from "./types.js";

/** design.md "PART_KIND": every rig has this static layer at BACKGROUND_Z; task 9: the whole plate. */
export const BACKGROUND_LAYER = "background";
export const BACKGROUND_Z = 1;

/** Requirement 6.1: layers of these kinds follow the head layer. */
export const HEAD_FOLLOWERS: readonly LayerKind[] = ["jaw", "eye", "accessory", "crown"];

/** The name of the head layer that HEAD_FOLLOWERS follow. */
const HEAD: PartName = "head";

export interface AssembleMeta {
  /** Rig id (a slug) and display name. */
  id: string;
  name: string;
  /** The portrait the parts were found on: canvas size and palette source (requirement 6.3). */
  portrait: Rgba;
  /** The filled plate (`composePlate`), drawn whole as the background layer. Defaults to the portrait. */
  plate?: Rgba;
}

export interface AssembleWarning {
  /** `palette_fallback` from samplePalette (ruling (b)); `no_head_layer` when follows were dropped. */
  code: PaletteWarning["code"] | "no_head_layer";
  message: string;
}

export interface AssembledRig {
  rig: Rig;
  /** PNG bytes for every `rig.layers[i].file`, keyed by that file name. */
  files: Record<string, Uint8Array>;
  warnings: AssembleWarning[];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

const boxOfLayer = ([x, y, w, h]: CutPart["bbox"]): Box => ({ x0: x, y0: y, x1: x + w, y1: y + h });

function boxOfPolygon(points: readonly [number, number][]): Box | undefined {
  if (points.length === 0) return undefined;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Mean of the pixel centres inside the polygon (non-zero rule); the vertex mean when none is inside. */
function centroid(points: readonly [number, number][], width: number, height: number): [number, number] {
  let n = 0;
  let sx = 0;
  let sy = 0;
  rasterizeMask([...points], width, height, 0).data.forEach((a, i) => {
    if (a === 0) return;
    n++;
    sx += (i % width) + 0.5;
    sy += Math.floor(i / width) + 0.5;
  });
  if (n > 0) return [sx / n, sy / n];
  const mean = (k: 0 | 1): number => points.reduce((s, p) => s + p[k], 0) / points.length;
  return [mean(0), mean(1)];
}

/**
 * Requirement 6.2, on the part's polygon in canvas px (the layer bbox when the part is unknown):
 * jaw = top-centre of its bbox (the hinge); eyes and accessories = centroid; head = bottom-centre;
 * torso, crown and anything else = bbox centre.
 */
function anchorOf(kind: LayerKind, layer: CutPart, part: Part | undefined, width: number, height: number): [number, number] {
  const points = part === undefined ? [] : toCanvas(part.poly, width, height);
  const box = boxOfPolygon(points) ?? boxOfLayer(layer.bbox);
  const cx = (box.x0 + box.x1) / 2;
  if (kind === "jaw") return [cx, box.y0];
  if (kind === "head") return [cx, box.y1];
  if ((kind === "eye" || kind === "accessory") && points.length > 0) return centroid(points, width, height);
  return [cx, (box.y0 + box.y1) / 2];
}

/**
 * Parts + cut layers (as `cutAll` returns them) -> Rig (requirements 6.1-6.4). The rig has
 * `version: 1`, `source: "forge"`, `fictional: true`, the portrait's size and a palette sampled
 * from the portrait (`samplePalette`; its warnings are passed on). Layers: BACKGROUND_LAYER
 * (static, z BACKGROUND_Z, the plate with the moving layers' cores painted out by `backgroundOf`
 * (task 10), so no pixel the parts leave uncovered is ever black and a turned head shows no copy), then the cut layers
 * back to front (reverse CUT_ORDER) at z 2, 3, ...; each is named after its part, has the kind
 * from PART_KIND, the default depth for that kind, the anchor from `anchorOf`, and the file
 * `<name>.png`. Jaw, eye, accessory and crown layers follow "head"; when no head layer is given
 * they follow nothing and a `no_head_layer` warning says so. The rig is passed through
 * validateRig; its errors are returned as they are.
 */
export function assembleRig(parts: readonly Part[], layers: readonly CutPart[], meta: AssembleMeta): Result<AssembledRig, RigError[]> {
  const { width, height } = meta.portrait;
  const plate = meta.plate ?? meta.portrait;
  if (plate.width !== width || plate.height !== height) {
    throw new RangeError(`assembleRig: plate ${plate.width}x${plate.height} does not match portrait ${width}x${height}`);
  }
  const { palette, warnings: paletteWarnings } = samplePalette(meta.portrait, parts);
  const warnings: AssembleWarning[] = [...paletteWarnings];
  const hasHead = layers.some((l) => l.name === HEAD);
  // Task 10: the background is painted under the moving layers, which may become opaque there.
  const painted = backgroundOf(plate, [...layers].sort((a, b) => CUT_ORDER.indexOf(a.name) - CUT_ORDER.indexOf(b.name)), parts);
  const order = [...painted.layers].reverse();
  if (!hasHead && order.some((l) => HEAD_FOLLOWERS.includes(PART_KIND[l.name]))) {
    warnings.push({ code: "no_head_layer", message: "no head layer; jaw, eyes, accessories and crown follow nothing" });
  }

  const files: Record<string, Uint8Array> = {};
  const background = `${BACKGROUND_LAYER}.png`;
  files[background] = encodePng(painted.background);
  const rigLayers: Layer[] = [
    { name: BACKGROUND_LAYER, z: BACKGROUND_Z, kind: "static", file: background, bbox: [0, 0, width, height], anchor: [width / 2, height / 2], depth: DEFAULT_DEPTH.static },
  ];
  order.forEach((layer, k) => {
    const kind = PART_KIND[layer.name];
    const file = `${layer.name}.png`;
    const [x, y, w, h] = layer.bbox;
    files[file] = encodePng(layer.image);
    rigLayers.push({
      name: layer.name,
      z: BACKGROUND_Z + 1 + k,
      kind,
      file,
      bbox: [x, y, w, h],
      anchor: anchorOf(kind, layer, parts.find((p) => p.name === layer.name), width, height),
      ...(hasHead && HEAD_FOLLOWERS.includes(kind) ? { follow: HEAD } : {}),
      depth: DEFAULT_DEPTH[kind],
    });
  });

  const rig: Rig = { version: RIG_VERSION, id: meta.id, name: meta.name, width, height, source: "forge", fictional: true, palette, layers: rigLayers };
  const checked = validateRig(rig);
  return checked.ok ? { ok: true, value: { rig: checked.value, files, warnings } } : checked;
}
