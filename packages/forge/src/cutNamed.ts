// The cut over named parts (cast-forge design.md "Named parts", requirement 2.2). The v1 `cutAll`
// algorithm (seams, keys, hood, plate) over any number of named parts in ROLE_ORDER, with two
// changes the design asks for: every non-plate part is lifted off the plate (not just FILL_PARTS),
// and the lifted region under a part is carried by the plate part its follow chain hangs on (a heart
// on the chest by the torso, a crown by the head), so the filled surface moves with its owner.
// Cast-forge task 3: a jaw's lifted region stops at its lip line, its layer's top edge is hard, and
// what it uncovers when it drops is a painted mouth cavity (mouth.ts), not a shaded smear; and a
// plate part keeps `parallaxBacking` px of surface under the plate part in front of it (the torso
// under the head), so a turned head never opens a gap onto the painted-out background at the seam.
// Cast-forge task 5: a lifted part with `matte: "plate"` keeps only what differs from the plate
// behind it (`matteToPlate`). Pure: plain arrays in, fresh images out.
import { DEFAULT_DEPTH, JAW_DROP, PITCH_SHIFT, YAW_SHIFT } from "@sr/rig";
import { type Cut, type CutOptions, CUT_FEATHER, HOOD_SHARE, PLATE_DILATE, addTo, blendBy, cutLayer, hoodShare, keyOf, seamReach, underFront } from "./cut.js";
import { KEY_HI, type Mask, cornerKeyLo, dilateMask, emptyMask, featherMask, rasterizeMask } from "./mask.js";
import { matteToPlate } from "./matte.js";
import { clearAboveLip, liftedJaw, paintCavity } from "./mouth.js";
import { carrierOf, cutOrderNamed, headNameOf, isKeyed, isLifted } from "./named.js";
import { composePlate, fallbackFill } from "./plate.js";
import { toCanvas } from "./parts.js";
import type { NamedPart, PartRole, Polygon, Rgba } from "./types.js";

export interface NamedCutPart extends Cut {
  name: string;
  role: PartRole;
}

export interface NamedCutOptions extends CutOptions {
  /** The art's pixel size in canvas px (CutStyle.cell): the mouth cavity steps on it. */
  cell?: number;
}

export interface NamedCutResult {
  /** Front to back (`cutOrderNamed`), one per part that kept any alpha. */
  layers: NamedCutPart[];
  /** Parts whose mask came out empty. */
  empty: string[];
  keyLo: number;
  /** Whether any hat-role part was treated as a hood. */
  hood: boolean;
}

/** Roles a hood gives up before it is cut (the v1 HOOD_YIELDS, plus the unpaired eye). */
const HOOD_YIELD_ROLES: readonly PartRole[] = ["head", "eye_l", "eye_r", "eye", "jaw"];

const polyOf = (part: NamedPart, width: number, height: number): Polygon => toCanvas(part.poly, width, height);

/**
 * How far a plate part reaches under the plate part in front of it (canvas px): the most a head
 * (depth 0.6) moves against a torso (depth 0.3) at full yaw or pitch. At rest the part in front
 * is opaque there, so nothing changes; turned, the seam shows the part behind, not the background.
 */
export function parallaxBacking(width: number, height: number): number {
  return Math.ceil(Math.max(YAW_SHIFT * width, PITCH_SHIFT * height) * (DEFAULT_DEPTH.head - DEFAULT_DEPTH.body));
}

/** One lifted part's region: its hard polygon, a jaw role's grown by JAW_GROW below its lip line (`liftedJaw`). */
function liftedOf(part: NamedPart, width: number, height: number): Mask {
  const hard = rasterizeMask(polyOf(part, width, height), width, height, 0);
  return part.role === "jaw" ? liftedJaw(hard) : hard;
}

/**
 * The region the fill paints: the hard union of every lifted (non-plate) part, or of the parts
 * `keep` accepts, a jaw role's grown by JAW_GROW. 255 inside. Pass it to `composePlate`.
 */
export function liftedNamed(parts: readonly NamedPart[], width: number, height: number, keep: (part: NamedPart) => boolean = () => true): Mask {
  const out = emptyMask(width, height);
  for (const part of parts) {
    if (!isLifted(part) || !keep(part)) continue;
    addTo(out, liftedOf(part, width, height));
  }
  return out;
}

/**
 * The filled plate for named parts (cast-forge task 3): the portrait with every lifted part painted
 * out, from `edit` (the image edit) where given, else from the pure `fallbackFill`; a part with
 * `fill: "extend"` is always painted from the surface around it (`fallbackFill`), never the edit.
 */
export function plateNamed(portrait: Rgba, parts: readonly NamedPart[], edit?: Rgba): Rgba {
  const { width, height } = portrait;
  const extend = (p: NamedPart): boolean => edit === undefined || p.fill === "extend";
  const fromEdit = liftedNamed(parts, width, height, (p) => !extend(p));
  const fromAround = liftedNamed(parts, width, height, extend);
  const edited = edit === undefined ? portrait : composePlate(portrait, edit, fromEdit);
  return composePlate(edited, fallbackFill(edited, fromAround), fromAround);
}

/**
 * Named parts -> layers. In `cutOrderNamed` order each part is cut as `cutAll` cuts a v1 part:
 * its polygon grown `seamReach` px under the parts in front and feathered inward; keyed when
 * `isKeyed`; a hat-role hood yields the head, eyes and jaw; every pixel where a part in front is
 * fully opaque is dropped, so cores never overlap. With `options.plate`, every lifted part is
 * opaque over its lifted region and feathers outward; a plate part (head, torso) is cut from the
 * plate inside the lifted region and also covers, grown by PLATE_DILATE, the lifted region of the
 * parts it carries (`carrierOf`) and reaches `parallaxBacking` px under the plate parts in front of
 * it; only a lifted core may then overlap a plate core, and a plate core the plate core in front.
 */
export function cutNamed(portrait: Rgba, parts: readonly NamedPart[], options: NamedCutOptions = {}): NamedCutResult {
  const { width, height } = portrait;
  const filled = options.plate !== undefined;
  const plate = options.plate ?? portrait;
  if (plate.width !== width || plate.height !== height) {
    throw new RangeError(`cutNamed plate: size ${plate.width}x${plate.height} does not match ${width}x${height}`);
  }
  const feather = options.feather ?? CUT_FEATHER;
  const order = cutOrderNamed(parts);

  const lifted = filled ? liftedNamed(parts, width, height) : emptyMask(width, height);
  const carried = new Map<string, Mask>();
  if (filled) {
    for (const part of parts) {
      const carrier = carrierOf(part, parts);
      if (!isLifted(part) || carrier === undefined) continue;
      const mask = carried.get(carrier) ?? emptyMask(width, height);
      addTo(mask, liftedOf(part, width, height));
      carried.set(carrier, mask);
    }
  }
  const surface = filled ? blendBy(portrait, plate, featherMask(lifted, feather)) : portrait;
  const hardOf = (part: NamedPart): Mask => rasterizeMask(polyOf(part, width, height), width, height, 0);
  if (filled) {
    for (const part of parts) {
      if (part.role !== "jaw" || part.cavity === "fill") continue;
      const hard = hardOf(part);
      const glow = part.glow === undefined ? {} : { glow: part.glow };
      const cell = options.cell === undefined ? {} : { cell: options.cell };
      const gap = part.cavity === "gap" ? { gap: true } : {};
      paintCavity(surface, portrait, hard, liftedJaw(hard), Math.round((part.drop ?? JAW_DROP) * height), { ...glow, ...cell, ...gap });
    }
  }

  const keyLo = Math.min(cornerKeyLo(portrait), KEY_HI - 1);
  let key: Mask | undefined;
  const headName = headNameOf(parts);
  const head = parts.find((p) => p.name === headName);
  const reach = seamReach(feather);
  let hood = false;

  const front = emptyMask(width, height);
  /** Hard union of the plate parts already cut: what a plate part behind them reaches under. */
  const plateFront = emptyMask(width, height);
  const backingPx = parallaxBacking(width, height);
  const core = new Uint8Array(width * height);
  const kept = new Uint8Array(width * height);
  const layers: NamedCutPart[] = [];
  const empty: string[] = [];
  for (const part of order) {
    const poly = polyOf(part, width, height);
    const up = isLifted(part);
    const own = filled && up ? liftedOf(part, width, height) : rasterizeMask(poly, width, height, 0);
    const shape = underFront(own, front, reach);
    if (filled && up) addTo(shape, dilateMask(own, feather));
    const carries = carried.get(part.name);
    if (filled && !up && carries !== undefined) addTo(shape, dilateMask(carries, PLATE_DILATE + feather));
    const backing = filled && !up ? dilateMask(own, backingPx) : undefined;
    if (backing !== undefined) for (let i = 0; i < backing.data.length; i++) backing.data[i] = backing.data[i] !== 0 && plateFront.data[i] !== 0 ? 255 : 0;
    if (backing !== undefined) addTo(shape, backing);
    const m = featherMask(shape, feather).data;
    // A lifted jaw's top edge is its lip line, hard: an open jaw carries none of the upper lip.
    if (filled && part.role === "jaw") clearAboveLip(m, hardOf(part));
    if (isKeyed(part)) {
      key ??= keyOf(portrait, keyLo, filled ? plate : undefined);
      for (let i = 0; i < m.length; i++) m[i] = Math.round(((m[i] ?? 0) * (key.data[i] ?? 0)) / 255);
    }
    // Before the core is claimed: what the matte clears stays free for the parts behind.
    const matted = filled && up && part.matte === "plate" ? matteToPlate(portrait, plate, m) : undefined;
    if (part.role === "hat" && head !== undefined && hoodShare(polyOf(head, width, height), poly, width, height) > HOOD_SHARE) {
      hood = true;
      for (const other of parts) {
        if (other === part || !HOOD_YIELD_ROLES.includes(other.role)) continue;
        const o = rasterizeMask(polyOf(other, width, height), width, height, feather).data;
        for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i] ?? 0, 255 - (o[i] ?? 0));
      }
    }
    const blocked = filled && !up ? kept : core;
    for (let i = 0; i < m.length; i++) {
      if (blocked[i] === 1 && backing?.data[i] !== 255) m[i] = 0;
      else if (m[i] === 255) {
        core[i] = 1;
        if (!up) kept[i] = 1;
      }
      if (own.data[i] !== 0) front.data[i] = 255;
      if (!up && own.data[i] !== 0) plateFront.data[i] = 255;
    }
    const cut = cutLayer(matted ?? (up ? portrait : surface), { width, height, data: m });
    if (cut === undefined) empty.push(part.name);
    else layers.push({ name: part.name, role: part.role, ...cut });
  }
  return { layers, empty, keyLo, hood };
}
