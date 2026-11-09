// Depth turn and lighting (perfection-pass V2): the rig data the WebGL renderer bends a head turn
// with. Pure, no DOM. The renderer (packages/avatar/src/gl/turn.ts) does the drawing; this module
// says how strong it is, which layers belong to the head, and where the face is.
//
// Decisions the spec leaves open (documented here so the renderer and the docs agree):
// - Strength: `Look.turn` wins over `Rig.turn` field by field; absent is TURN_DEFAULT (0.5 each),
//   0 disables, values are clamped to [0, 1]. Two art rules lower the default bend (never the light,
//   never a value the rig or look sets), from the cast's contact sheets: pixel art (`mouth.cell`)
//   takes warp 0, since a bend breaks its pixel grid; a head the forge found no lips on (no `mouth`:
//   a clock, a helmet, a fish, a skull) takes TURN_WARP_HARD, since a rigid face's straight painted
//   lines (a visor slit, a dial) visibly bow at the human default.
// - Membership is the follow chain: a layer is on the head when it is a `head` layer or follows
//   one, at any depth (face, eyes, irises, lids, brows, jaw, hair, hat, and props held by the
//   head). Body, background and whatever follows the torso keep today's rigid pan. A prop far off
//   the face is a member too, but the bend fades to nothing outside the face (gl/turn.ts), so it
//   pans as before and a prop that crosses the face stays glued to it.
// - The face is an ellipse in rest canvas px, from data every forged rig carries: centred between
//   the eyes on the head (a head's bbox takes in hair, hoods and veils, which are not the face),
//   FACE_OF_EYES times the eyes' half span wide (never wider than the head layer), FACE_TALL times
//   as tall (never taller), its centre FACE_DROP of its height below the eye line. A head without
//   eyes uses its own bbox.
import type { Layer, Look, Rig, RigTurn } from "./types.js";

/** Strength when neither the rig nor the look says (design "Task 3": conservative). */
export const TURN_DEFAULT: Readonly<Required<RigTurn>> = Object.freeze({ warp: 0.5, light: 0.5 });
/** The default bend of a head without a measured mouth (a rigid, non-human face). */
export const TURN_WARP_HARD = 0.3;
/** The face's half width per half span of the eyes (measured on the cast: 1.07..1.86, median 1.5). */
export const FACE_OF_EYES = 1.6;
/** The face's half height per half width. */
export const FACE_TALL = 1.3;
/** The face centre's drop below the eye line, as a share of its half height. */
export const FACE_DROP = 0.15;

/** The face ellipse, rest canvas px. */
export interface TurnFace {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const clamp01 = (value: number | undefined, fallback: number): number => (value === undefined || !Number.isFinite(value) ? fallback : Math.min(1, Math.max(0, value)));

/** The bend a rig takes when neither it nor the look sets one (the art rules above). */
export function defaultWarp(rig: Pick<Rig, "mouth">): number {
  if (rig.mouth?.cell !== undefined) return 0;
  return rig.mouth === undefined ? TURN_WARP_HARD : TURN_DEFAULT.warp;
}

/** The warp strength in force, 0..1 (no object: the renderer reads it per frame). */
export const turnWarp = (rig: Pick<Rig, "turn" | "mouth">, look: Pick<Look, "turn">): number => clamp01(look.turn?.warp ?? rig.turn?.warp, defaultWarp(rig));
/** The light strength in force, 0..1. */
export const turnLight = (rig: Pick<Rig, "turn">, look: Pick<Look, "turn">): number => clamp01(look.turn?.light ?? rig.turn?.light, TURN_DEFAULT.light);

/** The warp and light strengths in force, 0..1 each. */
export function turnStrength(rig: Pick<Rig, "turn" | "mouth">, look: Pick<Look, "turn">): { warp: number; light: number } {
  return { warp: turnWarp(rig, look), light: turnLight(rig, look) };
}

/** What `turnHead` finds, cached per rig object. */
export interface TurnHead {
  /** The first `head` layer that follows no head (the head group's root). */
  head: Layer;
  /** Names of the layers on the head (the root, and every layer whose follow chain reaches a head). */
  members: ReadonlySet<string>;
  face: TurnFace;
}

const cache = new WeakMap<Pick<Rig, "layers">, TurnHead | null>();

/** Whether `layer` is a head layer or follows one (missing or cyclic parents end the chain). */
function onHead(layer: Layer, byName: ReadonlyMap<string, Layer>): boolean {
  const seen = new Set<string>();
  for (let at: Layer | undefined = layer; at !== undefined && !seen.has(at.name); at = at.follow === undefined ? undefined : byName.get(at.follow)) {
    if (at.kind === "head") return true;
    seen.add(at.name);
  }
  return false;
}

function faceOf(head: Layer, eyes: readonly Layer[]): TurnFace {
  const [hx, hy, hw, hh] = head.bbox;
  if (eyes.length === 0) return { cx: hx + hw / 2, cy: hy + hh / 2, rx: hw / 2, ry: hh / 2 };
  let x0 = Infinity;
  let x1 = -Infinity;
  let ey = 0;
  for (const eye of eyes) {
    x0 = Math.min(x0, eye.bbox[0]);
    x1 = Math.max(x1, eye.bbox[0] + eye.bbox[2]);
    ey += eye.bbox[1] + eye.bbox[3] / 2;
  }
  ey /= eyes.length;
  const rx = Math.max(1, Math.min(hw / 2, (FACE_OF_EYES * (x1 - x0)) / 2));
  const ry = Math.max(1, Math.min(hh / 2, FACE_TALL * rx));
  const cx = Math.min(hx + hw, Math.max(hx, (x0 + x1) / 2));
  return { cx, cy: ey + FACE_DROP * ry, rx, ry };
}

/** The rig's head group and face (cached per rig object), or undefined when no visible head. */
export function turnHead(rig: Pick<Rig, "layers">): TurnHead | undefined {
  const known = cache.get(rig);
  if (known !== undefined) return known ?? undefined;
  const byName = new Map(rig.layers.map((layer) => [layer.name, layer]));
  const parentOnHead = (layer: Layer): boolean => {
    const parent = layer.follow === undefined || layer.follow === layer.name ? undefined : byName.get(layer.follow);
    return parent !== undefined && onHead(parent, byName);
  };
  const head = rig.layers.find((layer) => layer.kind === "head" && layer.visible !== false && !parentOnHead(layer));
  if (head === undefined) {
    cache.set(rig, null);
    return undefined;
  }
  const members = new Set(rig.layers.filter((layer) => onHead(layer, byName)).map((layer) => layer.name));
  const eyes = rig.layers.filter((layer) => layer.kind === "eye" && layer.visible !== false && members.has(layer.name));
  const found: TurnHead = { head, members, face: faceOf(head, eyes) };
  cache.set(rig, found);
  return found;
}
