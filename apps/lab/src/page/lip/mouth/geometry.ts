// Where a character's mouth is, from its rig (pure, no DOM; the Node mouth generator in src/mouths
// crops the same square). Rig v1 has one `jaw` layer and no mouth art of its own: the mouth line is
// the jaw's top edge, centred on the jaw, and the mouth is a share of the jaw's width capped by the
// head's (a skull's jaw is as wide as the face; its mouth is not).
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

export function mouthGeometry(jaw: { bbox: Box }, head?: { bbox: Box }): MouthGeometry {
  const [jx, jy, jw] = jaw.bbox;
  const cap = head === undefined ? Infinity : head.bbox[2] * MOUTH_OF_HEAD;
  const width = Math.max(1, Math.min(jw * MOUTH_OF_JAW, cap));
  const cx = jx + jw / 2;
  const lineY = jy;
  const side = Math.max(8, Math.round(width * CROP_OF_WIDTH));
  const crop: MouthGeometry["crop"] = [Math.round(cx - side / 2), Math.round(lineY + width * 0.12 - side / 2), side, side];
  return { cx, lineY, width, maxOpen: width * OPEN_OF_WIDTH, crop };
}
