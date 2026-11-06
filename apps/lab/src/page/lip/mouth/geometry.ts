// Where a character's mouth is, from its rig (pure, no DOM; the Node mouth generator in src/mouths
// crops the same square). Rig v1 has one `jaw` layer and no mouth art of its own: the mouth line is
// the jaw's top edge, centred on the jaw, and the mouth is a share of the jaw's width capped by the
// head's (a skull's jaw is as wide as the face; its mouth is not). A rig that carries its measured
// mouth (Rig.mouth: centre, lip line, width) is taken as is instead of that guess.
// No imports: the Node generator (src/mouths) shares it.

export type Box = readonly [x: number, y: number, w: number, h: number];

export interface MouthGeometry {
  /** Mouth centre x and mouth line y, rig canvas px. */
  cx: number;
  lineY: number;
  /** The rest mouth's width, rig px. */
  width: number;
  /** The largest inner opening an arm draws, rig px. */
  maxOpen: number;
  /** The square L2's art covers, rig px (integers). */
  crop: [x: number, y: number, side: number, side: number];
}

export const MOUTH_OF_JAW = 0.85;
export const MOUTH_OF_HEAD = 0.32;
export const OPEN_OF_WIDTH = 0.32;
export const CROP_OF_WIDTH = 1.8;

/** The rig's measured rest mouth (structurally @sr/rig's RigMouth), canvas px. */
export interface MeasuredMouth {
  cx: number;
  lineY: number;
  width: number;
}

const usable = (m: MeasuredMouth | undefined): m is MeasuredMouth => m !== undefined && Number.isFinite(m.cx) && Number.isFinite(m.lineY) && Number.isFinite(m.width) && m.width > 0;

export function mouthGeometry(jaw: { bbox: Box }, head?: { bbox: Box }, measured?: MeasuredMouth): MouthGeometry {
  if (usable(measured)) return geometryAt(measured.cx, measured.lineY, Math.max(1, measured.width));
  const [jx, jy, jw] = jaw.bbox;
  const cap = head === undefined ? Infinity : head.bbox[2] * MOUTH_OF_HEAD;
  const width = Math.max(1, Math.min(jw * MOUTH_OF_JAW, cap));
  return geometryAt(jx + jw / 2, jy, width);
}

/** maxOpen and L2's crop square, derived from the mouth's width alone. */
function geometryAt(cx: number, lineY: number, width: number): MouthGeometry {
  const side = Math.max(8, Math.round(width * CROP_OF_WIDTH));
  const crop: MouthGeometry["crop"] = [Math.round(cx - side / 2), Math.round(lineY + width * 0.12 - side / 2), side, side];
  return { cx, lineY, width, maxOpen: width * OPEN_OF_WIDTH, crop };
}
