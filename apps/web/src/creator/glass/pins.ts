// Where the Forge pins its labels on the face (costume 3.1, design.md "Creator"): every position on
// the glass comes from the rig's own layer boxes and anchors, mapped the way the renderer fits the
// rig into its canvas (contain, centred; avatar render/frame.ts `fitView`). The glass is square, so
// the map is to percent of that square, and a label tracks the face at any size. Pure, no DOM.
//
// Decisions the spec leaves open:
// - Each light is pinned to the part that carries it: eye light on the eye that sits screen-left,
//   glow on the accessory (Malakor's monocle) or else the crown or the other eye, mouth light on
//   the jaw, rim light on the head's leading edge. A rig without such a part falls back to the head
//   (or the union of the moving layers), so every rig gets four pins.
// - Labels sit on the side of the glass their pin is on, at the edge, and are pushed apart
//   vertically so two on one side never overlap (a minimum gap of `TAG_GAP` percent).
import { isEmissive, type Layer, type LayerKind, type Palette, type Rig } from "@sr/rig";

export type LightKey = keyof Palette;
export type Point = [x: number, y: number];

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Pin {
  key: LightKey;
  /** Where the light lives, percent of the glass. */
  at: Point;
  /** Where its label sits, percent of the glass (the label's inner edge on `side`). */
  tag: Point;
  side: "start" | "end";
}

/** The order the labels are listed in (tab order follows it). */
export const LIGHT_ORDER: readonly LightKey[] = ["rim", "eye", "glow", "mouth"];

/** Minimum vertical distance between two labels on one side, percent. */
export const TAG_GAP = 9;
/** Labels stay this far inside the glass, percent. */
export const TAG_MARGIN = 6;
/** Horizontal place of a label's inner edge, percent from its side (the label hangs outward from it). */
export const TAG_INSET = 21;

/** A rig px point -> percent of a square glass the rig is fitted into whole (contain, centred). */
export function toGlass(rig: Pick<Rig, "width" | "height">, [x, y]: Point): Point {
  const side = Math.max(rig.width, rig.height, 1);
  const offX = (side - rig.width) / 2;
  const offY = (side - rig.height) / 2;
  return [((offX + x) / side) * 100, ((offY + y) / side) * 100];
}

/** Percent of the glass -> rig px (the inverse of `toGlass`). */
export function fromGlass(rig: Pick<Rig, "width" | "height">, [x, y]: Point): Point {
  const side = Math.max(rig.width, rig.height, 1);
  return [(x / 100) * side - (side - rig.width) / 2, (y / 100) * side - (side - rig.height) / 2];
}

/** A layer box (rig px) -> percent of the glass. */
export function boxOf(rig: Pick<Rig, "width" | "height">, bbox: Layer["bbox"]): Box {
  const [left, top] = toGlass(rig, [bbox[0], bbox[1]]);
  const [right, bottom] = toGlass(rig, [bbox[0] + bbox[2], bbox[1] + bbox[3]]);
  return { left, top, width: right - left, height: bottom - top };
}

const centre = (bbox: Layer["bbox"]): Point => [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2];
const within = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The union of the boxes of `layers` (rig px), or the whole canvas when there are none. */
function union(rig: Pick<Rig, "width" | "height">, layers: readonly Layer[]): Layer["bbox"] {
  if (layers.length === 0) return [0, 0, rig.width, rig.height];
  const x0 = Math.min(...layers.map((l) => l.bbox[0]));
  const y0 = Math.min(...layers.map((l) => l.bbox[1]));
  const x1 = Math.max(...layers.map((l) => l.bbox[0] + l.bbox[2]));
  const y1 = Math.max(...layers.map((l) => l.bbox[1] + l.bbox[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

const ofKind = (rig: Rig, kind: LayerKind): Layer[] => rig.layers.filter((l) => l.kind === kind);

/** The rig px point each light is pinned to (always inside the box of the part that carries it). */
export function lightPoints(rig: Rig): Record<LightKey, Point> {
  const head = ofKind(rig, "head")[0]?.bbox ?? union(rig, rig.layers.filter((l) => l.kind !== "static"));
  const eyes = [...ofKind(rig, "eye")].sort((a, b) => centre(a.bbox)[0] - centre(b.bbox)[0]);
  const firstEye = eyes[0];
  // The glow is pinned to a part that gives light (`isEmissive`), never to a glove or an abacus.
  const accessory = [...ofKind(rig, "accessory").filter(isEmissive)].sort((a, b) => b.z - a.z)[0];
  const crown = ofKind(rig, "crown").filter(isEmissive);
  const jaw = ofKind(rig, "jaw")[0];
  const eye: Point = firstEye === undefined ? [head[0] + head[2] * 0.35, head[1] + head[3] * 0.4] : centre(firstEye.bbox);
  const glowLayer = accessory ?? eyes[1];
  const glow: Point =
    glowLayer !== undefined
      ? centre(glowLayer.bbox)
      : crown.length > 0
        ? centre(union(rig, crown))
        : [head[0] + head[2] * 0.65, head[1] + head[3] * 0.4];
  const mouth: Point = jaw === undefined ? [head[0] + head[2] / 2, head[1] + head[3] * 0.8] : [jaw.bbox[0] + jaw.bbox[2] / 2, jaw.bbox[1] + jaw.bbox[3] * 0.45];
  const rim: Point = [head[0] + head[2] * 0.12, head[1] + head[3] * 0.3];
  return { eye, glow, mouth, rim };
}

/** Spreads sorted wanted y values apart by `gap` inside [lo, hi] (as far as they fit), keeping order. */
export function spread(wanted: readonly number[], gap: number, lo: number, hi: number): number[] {
  const fit = wanted.length <= 1 ? gap : Math.min(gap, (hi - lo) / (wanted.length - 1));
  const out: number[] = [];
  for (const y of wanted) {
    const prev = out.at(-1);
    out.push(within(prev === undefined ? y : Math.max(y, prev + fit), lo, hi));
  }
  // Walk back from the bottom, so a crowded lower edge pushes its neighbours up.
  for (let i = out.length - 2; i >= 0; i -= 1) {
    const next = out[i + 1] ?? hi;
    const cur = out[i] ?? lo;
    out[i] = Math.max(lo, Math.min(cur, next - fit));
  }
  return out;
}

/** The four pins of `rig`: each light where it lives, its label at the glass edge on that side. */
export function lightPins(rig: Rig): Pin[] {
  const points = lightPoints(rig);
  const placed = LIGHT_ORDER.map((key) => {
    const at = toGlass(rig, points[key]);
    const side: Pin["side"] = key === "rim" || at[0] <= 50 ? "start" : "end";
    return { key, at, side };
  });
  const pins: Pin[] = [];
  for (const side of ["start", "end"] as const) {
    const group = placed.filter((p) => p.side === side).sort((a, b) => a.at[1] - b.at[1]);
    const ys = spread(
      group.map((p) => within(p.at[1] + (p.key === "rim" ? -12 : 4), TAG_MARGIN, 100 - TAG_MARGIN)),
      TAG_GAP,
      TAG_MARGIN,
      100 - TAG_MARGIN,
    );
    group.forEach((p, i) => pins.push({ ...p, tag: [side === "start" ? TAG_INSET : 100 - TAG_INSET, ys[i] ?? p.at[1]] }));
  }
  return LIGHT_ORDER.flatMap((key) => pins.filter((p) => p.key === key));
}

/** The front-most layer of one of `kinds` whose box holds `point` (percent of the glass), if any. */
export function layerAt(rig: Rig, point: Point, kinds: readonly LayerKind[]): Layer | undefined {
  return [...rig.layers]
    .filter((l) => kinds.includes(l.kind))
    .sort((a, b) => b.z - a.z)
    .find((l) => {
      const b = boxOf(rig, l.bbox);
      return point[0] >= b.left && point[0] <= b.left + b.width && point[1] >= b.top && point[1] <= b.top + b.height;
    });
}
