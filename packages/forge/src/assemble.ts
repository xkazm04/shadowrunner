// Assembly (forge-pipeline requirement 6; task 5): parts + cut layers -> a Rig v1 that
// validateRig accepts, plus the PNG bytes behind each layer file. Pure: no network, no clock.
import { DEFAULT_DEPTH, type Layer, type LayerKind, RIG_VERSION, type Result, type Rig, type RigError, validateRig } from "@sr/rig";
import { CUT_ORDER } from "./cut.js";
import { encodePng } from "./image.js";
import { dilateMask, rasterizeMask } from "./mask.js";
import { artMouth, drawnMouth, measureLips, measureMouth } from "./mouthAnchor.js";
import { measureMaw } from "./mouthMaw.js";
import { type NamedLayer, backgroundOf } from "./background.js";
import { asNamed, cutOrderNamed, emissiveOf, followOf, headNameOf, motionOf, scaleMotion } from "./named.js";
import { samplePalette, type PaletteWarning } from "./palette.js";
import { MOTION_CANVAS, ROLE_KIND, toCanvas, v1View } from "./parts.js";
import type { NamedPart, Part, Rgba } from "./types.js";

/** design.md "PART_KIND": every rig has this static layer at BACKGROUND_Z; task 9: the whole plate. */
export const BACKGROUND_LAYER = "background";
export const BACKGROUND_Z = 1;

/** Requirement 6.1: layers of these kinds follow the head layer. */
export const HEAD_FOLLOWERS: readonly LayerKind[] = ["jaw", "eye", "accessory", "crown"];

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

const boxOfLayer = ([x, y, w, h]: NamedLayer["bbox"]): Box => ({ x0: x, y0: y, x1: x + w, y1: y + h });

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

/** How near (canvas px) a part's pixel must be to its follow target's polygon to count as where it is attached. */
export const PIVOT_REACH = 4;

/**
 * Cast-forge task 4: an attached part (an accessory or pulse role with an explicit follow) turns
 * about where it meets its target, not about its middle: a lure stalk sways about its foot on the
 * brow, a bulb swings from the stalk's tip. The mean of the part's pixels within PIVOT_REACH px of
 * the target's polygon; undefined when none are (the part is not attached: the centroid stands).
 * A part lying wholly on its target (a stamp on the chest) gets its centroid, as before.
 */
export function pivotOf(part: Pick<NamedPart, "poly">, target: Pick<NamedPart, "poly">, width: number, height: number): [number, number] | undefined {
  const own = rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data;
  const near = dilateMask(rasterizeMask(toCanvas(target.poly, width, height), width, height, 0), PIVOT_REACH).data;
  let n = 0;
  let sx = 0;
  let sy = 0;
  own.forEach((a, i) => {
    if (a === 0 || near[i] === 0) return;
    n++;
    sx += (i % width) + 0.5;
    sy += Math.floor(i / width) + 0.5;
  });
  return n === 0 ? undefined : [sx / n, sy / n];
}

/**
 * Requirement 6.2, on the part's polygon in canvas px (the layer bbox when the part is unknown):
 * jaw = top-centre of its bbox (the hinge); eyes and accessories = centroid; head = bottom-centre;
 * torso, crown and anything else = bbox centre.
 */
function anchorOf(kind: LayerKind, layer: NamedLayer, part: Pick<Part, "poly"> | undefined, width: number, height: number): [number, number] {
  const points = part === undefined ? [] : toCanvas(part.poly, width, height);
  const box = boxOfPolygon(points) ?? boxOfLayer(layer.bbox);
  const cx = (box.x0 + box.x1) / 2;
  if (kind === "jaw") return [cx, box.y0];
  if (kind === "head") return [cx, box.y1];
  if ((kind === "eye" || kind === "accessory") && points.length > 0) return centroid(points, width, height);
  return [cx, (box.y0 + box.y1) / 2];
}

/**
 * Parts + cut layers (as `cutAll` returns them, or `cutNamed` for named parts) -> Rig
 * (requirements 6.1-6.4; cast-forge requirement 2.3). The rig has `version: 1`, `source: "forge"`,
 * `fictional: true`, the portrait's size and a palette sampled from the portrait (`samplePalette`
 * on the v1 view; its warnings are passed on). Layers: BACKGROUND_LAYER (static, z BACKGROUND_Z,
 * the plate with the moving layers' cores painted out by `backgroundOf` (task 10)), then the cut
 * layers back to front (reverse CUT_ORDER; named parts: reverse `cutOrderNamed`) at z 2, 3, ...;
 * each is named after its part, has the kind of its role (ROLE_KIND; a v1 part's role is its name),
 * the anchor from `anchorOf` (an attached part's from `pivotOf`, a part's own `pivot` first), and the file `<name>.png`. Follow: the part's own, else every
 * non-plate role follows the head part (`followOf`); a target with no layer passes the follow on to
 * its own target, and when the head has no layer a `no_head_layer` warning says so. Depth: the
 * kind's default, except that a part with an explicit follow takes its target's depth (a heart on
 * the chest moves with the chest, not ahead of it). Motion (`motionOf`) is scaled from
 * MOTION_CANVAS px to the portrait. A jaw part's `drop` becomes its layer's
 * `drop` (cast-forge task 3). A named part's layer takes `emissiveOf` (task 12 follow-up: a part of
 * an emissive kind that gives no light is `emissive: false`); a v1 file's layers keep the kind's
 * default. With a jaw layer the rig carries `mouth` (`measureMouth` on the first jaw, capped by the
 * first head), unless a jaw part says the mouth is drawn open (`drawnMouth`: cavity "gap" or "fill",
 * a visor or a maw), when the art keeps its mouth; cast-face-pass: a jaw flagged `mouth: "art"` whose
 * maw measures cleanly (`measureMaw`) carries `mouth` with maw lips. The rig is passed through validateRig; its errors are returned
 * as they are.
 */
export function assembleRig(parts: readonly Part[] | readonly NamedPart[], layers: readonly NamedLayer[], meta: AssembleMeta): Result<AssembledRig, RigError[]> {
  const { width, height } = meta.portrait;
  const plate = meta.plate ?? meta.portrait;
  if (plate.width !== width || plate.height !== height) {
    throw new RangeError(`assembleRig: plate ${plate.width}x${plate.height} does not match portrait ${width}x${height}`);
  }
  const named = asNamed(parts);
  const isV2 = parts.some((p) => "role" in p);
  const byName = new Map<string, NamedPart>();
  for (const part of named) if (!byName.has(part.name)) byName.set(part.name, part);
  const { palette, warnings: paletteWarnings } = samplePalette(meta.portrait, isV2 ? v1View(named) : parts.filter((p): p is Part => !("role" in p)));
  const warnings: AssembleWarning[] = [...paletteWarnings];
  const rank: readonly string[] = isV2 ? cutOrderNamed(named).map((p) => p.name) : CUT_ORDER;
  // Task 10: the background is painted under the moving layers, which may become opaque there.
  const painted = backgroundOf(plate, [...layers].sort((a, b) => rank.indexOf(a.name) - rank.indexOf(b.name)), named);
  const order = [...painted.layers].reverse();
  const present = new Set(order.map((l) => l.name));
  const headName = headNameOf(named);
  let headless = false;

  /** The part's follow, passed on past targets that have no layer; flags a missing head. */
  const followFor = (part: NamedPart): string | undefined => {
    const seen = new Set([part.name]);
    let target = followOf(part, headName);
    while (target !== undefined && !present.has(target) && !seen.has(target)) {
      if (target === headName) headless = true;
      seen.add(target);
      const next = byName.get(target);
      target = next === undefined ? undefined : followOf(next, headName);
    }
    return target !== undefined && present.has(target) ? target : undefined;
  };
  /** Resolved follows, with any cycle (possible only in input parseParts would reject) broken at its first layer. */
  const follows = new Map<string, string>();
  for (const layer of order) {
    const part = byName.get(layer.name);
    const target = part === undefined ? undefined : followFor(part);
    if (target !== undefined) follows.set(layer.name, target);
  }
  for (const layer of order) {
    const seen = new Set<string>([layer.name]);
    for (let at = follows.get(layer.name); at !== undefined; at = follows.get(at)) {
      if (!seen.has(at)) {
        seen.add(at);
        continue;
      }
      follows.delete(layer.name);
      break;
    }
  }
  const kindOf = (name: string): LayerKind => ROLE_KIND[byName.get(name)?.role ?? "accessory"];
  const depths = new Map<string, number>();
  const depthOf = (name: string, seen: Set<string> = new Set()): number => {
    const known = depths.get(name);
    if (known !== undefined) return known;
    const part = byName.get(name);
    const target = part?.follow === undefined ? undefined : follows.get(name);
    const depth = target !== undefined && !seen.has(target) ? depthOf(target, seen.add(name)) : DEFAULT_DEPTH[kindOf(name)];
    depths.set(name, depth);
    return depth;
  };

  /** An attached part's pivot (`pivotOf`) on its explicit follow target, when it has a layer. */
  const attachedPivot = (part: NamedPart | undefined): [number, number] | undefined => {
    if (part === undefined || part.follow === undefined || part.role === "float" || ROLE_KIND[part.role] !== "accessory") return undefined;
    const on = follows.get(part.name);
    const target = on === undefined ? undefined : byName.get(on);
    return target === undefined ? undefined : pivotOf(part, target, width, height);
  };

  /** A part's own `pivot` (cast-forge task 5: a clock hand's hub) in canvas px. */
  const ownPivot = (part: NamedPart | undefined): [number, number] | undefined => (part?.pivot === undefined ? undefined : toCanvas([part.pivot], width, height)[0]);

  const files: Record<string, Uint8Array> = {};
  const background = `${BACKGROUND_LAYER}.png`;
  files[background] = encodePng(painted.background);
  const rigLayers: Layer[] = [
    { name: BACKGROUND_LAYER, z: BACKGROUND_Z, kind: "static", file: background, bbox: [0, 0, width, height], anchor: [width / 2, height / 2], depth: DEFAULT_DEPTH.static },
  ];
  order.forEach((layer, k) => {
    const kind = kindOf(layer.name);
    const part = byName.get(layer.name);
    const file = `${layer.name}.png`;
    const [x, y, w, h] = layer.bbox;
    const follow = follows.get(layer.name);
    const motion = part === undefined ? undefined : motionOf(part);
    const emissive = part === undefined || !isV2 ? undefined : emissiveOf(part, kind);
    files[file] = encodePng(layer.image);
    rigLayers.push({
      name: layer.name,
      z: BACKGROUND_Z + 1 + k,
      kind,
      file,
      bbox: [x, y, w, h],
      anchor: ownPivot(part) ?? attachedPivot(part) ?? anchorOf(kind, layer, part, width, height),
      ...(follow === undefined ? {} : { follow }),
      depth: depthOf(layer.name),
      ...(motion === undefined ? {} : { motion: scaleMotion(motion, width, height, MOTION_CANVAS) }),
      ...(kind === "jaw" && part?.drop !== undefined ? { drop: part.drop } : {}),
      ...(emissive === undefined ? {} : { emissive }),
      ...(part?.act === undefined ? {} : { act: part.act }),
    });
  });
  if (headless) warnings.push({ code: "no_head_layer", message: "no head layer; jaw, eyes, accessories and crown follow nothing" });

  // llm-avatar-lab: the rig owns the mouth; it is measured on the first jaw layer as shipped. A mouth
  // drawn open (a visor, a maw: `drawnMouth`) stays the art's: no `mouth`, so nothing resets or covers it.
  const jawLayer = drawnMouth(named) ? undefined : order.find((l) => kindOf(l.name) === "jaw");
  const headLayer = order.find((l) => kindOf(l.name) === "head");
  const measured = jawLayer === undefined ? undefined : measureMouth(jawLayer, headLayer);
  // art-mouth: the painted lips on the rest head + jaw (bottom first), omitted when measureLips is unsure.
  const rest = order.filter((l) => l === headLayer || l === jawLayer);
  const lips = measured === undefined ? undefined : measureLips(rest, measured);
  let mouth: Rig["mouth"] = measured === undefined ? undefined : { ...measured, ...(lips === undefined ? {} : { lips }) };
  // cast-face-pass: a jaw whose art owns the mouth (`mouth: "art"`, a grin of teeth) gets the mouth back
  // when its maw measures cleanly (`measureMaw`: lips with `maw`), so the warp moves its own teeth; unsure, none.
  const artJaw = artMouth(named) ? order.find((l) => kindOf(l.name) === "jaw") : undefined;
  const artMeasured = artJaw === undefined ? undefined : measureMouth(artJaw, headLayer);
  const maw = artJaw === undefined || artMeasured === undefined ? undefined : measureMaw(order.filter((l) => l === headLayer || l === artJaw), artMeasured);
  if (artMeasured !== undefined && maw !== undefined) mouth = { ...artMeasured, lips: maw };
  const rig: Rig = { version: RIG_VERSION, id: meta.id, name: meta.name, width, height, source: "forge", fictional: true, palette, layers: rigLayers, ...(mouth === undefined ? {} : { mouth }) };
  const checked = validateRig(rig);
  return checked.ok ? { ok: true, value: { rig: checked.value, files, warnings } } : checked;
}
