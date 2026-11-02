// The cut over named parts (cast-forge design.md "Named parts", requirement 2.2). The v1 `cutAll`
// algorithm (seams, keys, hood, plate) over any number of named parts in ROLE_ORDER, with two
// changes the design asks for: every non-plate part is lifted off the plate (not just FILL_PARTS),
// and the lifted region under a part is carried by the plate part its follow chain hangs on (a heart
// on the chest by the torso, a crown by the head), so the filled surface moves with its owner.
// Pure: plain arrays in, fresh images out.
import { type Cut, type CutOptions, CUT_FEATHER, HOOD_SHARE, JAW_GROW, PLATE_DILATE, addTo, blendBy, cutLayer, hoodShare, keyOf, seamReach, shadeMouthIn, underFront } from "./cut.js";
import { KEY_HI, type Mask, cornerKeyLo, dilateMask, emptyMask, featherMask, rasterizeMask } from "./mask.js";
import { carrierOf, cutOrderNamed, headNameOf, isKeyed, isLifted } from "./named.js";
import { toCanvas } from "./parts.js";
import type { NamedPart, PartRole, Polygon, Rgba } from "./types.js";

export interface NamedCutPart extends Cut {
  name: string;
  role: PartRole;
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

/** One lifted part's region: its hard polygon, a jaw role's grown by JAW_GROW. */
function liftedOf(part: NamedPart, width: number, height: number): Mask {
  const hard = rasterizeMask(polyOf(part, width, height), width, height, 0);
  return part.role === "jaw" ? dilateMask(hard, JAW_GROW) : hard;
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
 * Named parts -> layers. In `cutOrderNamed` order each part is cut as `cutAll` cuts a v1 part:
 * its polygon grown `seamReach` px under the parts in front and feathered inward; keyed when
 * `isKeyed`; a hat-role hood yields the head, eyes and jaw; every pixel where a part in front is
 * fully opaque is dropped, so cores never overlap. With `options.plate`, every lifted part is
 * opaque over its lifted region and feathers outward; a plate part (head, torso) is cut from the
 * plate inside the lifted region and also covers, grown by PLATE_DILATE, the lifted region of the
 * parts it carries (`carrierOf`); only a lifted core may then overlap a plate core.
 */
export function cutNamed(portrait: Rgba, parts: readonly NamedPart[], options: CutOptions = {}): NamedCutResult {
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
  const jaws = liftedNamed(parts, width, height, (p) => p.role === "jaw");
  const surface = filled ? shadeMouthIn(blendBy(portrait, plate, featherMask(lifted, feather)), jaws) : portrait;

  const keyLo = Math.min(cornerKeyLo(portrait), KEY_HI - 1);
  let key: Mask | undefined;
  const headName = headNameOf(parts);
  const head = parts.find((p) => p.name === headName);
  const reach = seamReach(feather);
  let hood = false;

  const front = emptyMask(width, height);
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
    const m = featherMask(shape, feather).data;
    if (isKeyed(part)) {
      key ??= keyOf(portrait, keyLo, filled ? plate : undefined);
      for (let i = 0; i < m.length; i++) m[i] = Math.round(((m[i] ?? 0) * (key.data[i] ?? 0)) / 255);
    }
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
      if (blocked[i] === 1) m[i] = 0;
      else if (m[i] === 255) {
        core[i] = 1;
        if (!up) kept[i] = 1;
      }
      if (own.data[i] !== 0) front.data[i] = 255;
    }
    const cut = cutLayer(up ? portrait : surface, { width, height, data: m });
    if (cut === undefined) empty.push(part.name);
    else layers.push({ name: part.name, role: part.role, ...cut });
  }
  return { layers, empty, keyLo, hood };
}
