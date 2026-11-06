// Where the rig's mouth is (llm-avatar-lab: the rig owns the mouth). The jaw's top edge is the lip
// line (mouth.ts `lipLine`); `Rig.mouth` records it so a renderer draws the talking mouth there and
// the expression faces can be reset to the neutral mouth around it. Pure: arrays in, numbers out.
import type { RigMouth } from "@sr/rig";
import type { Mask } from "./mask.js";
import { lipLine } from "./mouth.js";
import type { Rgba } from "./types.js";

// art-mouth: the painted lips' box about the mouth (`measureLips`) lives beside it (line cap).
export * from "./mouthLips.js";

/**
 * The mouth's width as a share of the jaw's opaque span, capped at a share of the head's width (a
 * skull's jaw is as wide as the face; its mouth is not). The same numbers as the lab's
 * apps/lab/src/page/lip/mouth/geometry.ts MOUTH_OF_JAW / MOUTH_OF_HEAD, duplicated on purpose:
 * packages never import from apps.
 */
export const MOUTH_OF_JAW = 0.85;
export const MOUTH_OF_HEAD = 0.32;
/** The lip line is the median top edge over this middle share of the jaw's opaque columns. */
export const LIP_MIDDLE_SHARE = 0.6;
/** A jaw pixel counts as opaque from this alpha (an Rgba jaw). */
export const MOUTH_OPAQUE = 128;

type Box = readonly [x: number, y: number, w: number, h: number];

/**
 * The jaw cavities of a mouth drawn open (round 3: a lipless mouth keeps its art): "gap" (a visor's
 * slit, a grin over a dark gap: Sir Vacant, Reveille) and "fill" (a maw of teeth over a lit throat:
 * the Vicar, Reveille's teeth). A "paint" jaw (omitted) is a lower lip and gets `Rig.mouth`.
 */
export const DRAWN_MOUTH_CAVITIES: readonly string[] = ["gap", "fill"];

/**
 * The explicit flag for a jaw whose art owns the mouth but whose cavity must stay painted the way
 * it is (`mouth: "art"`): a skull's grin of teeth, a carved lantern grin. `cavity` "gap"/"fill"
 * would also say "drawn", but they change what the cut paints into the head (measured on the
 * Announcer and the Lantern Warden: 5-10k head pixels differ), so those two jaws carry this instead.
 */
export const ART_MOUTH = "art";

/**
 * True when the art owns the mouth: some jaw part's `cavity` is in DRAWN_MOUTH_CAVITIES, or it is
 * flagged `mouth: "art"` (ART_MOUTH). Then the rig carries no `mouth`, so no renderer draws lips
 * over the art and `cutVariants` resets nothing. `glow` alone does not count (the Tallyman's lip
 * over a lit cavity) nor does `cut.cell`. A jaw with neither is the human jaw PARTS_PROMPT asks for.
 */
export function drawnMouth(parts: readonly { role?: string; cavity?: string; mouth?: string }[]): boolean {
  return parts.some(
    (p) => p.role === "jaw" && ((p.cavity !== undefined && DRAWN_MOUTH_CAVITIES.includes(p.cavity)) || p.mouth === ART_MOUTH),
  );
}

/** cast-face-pass: true when some jaw part is flagged `mouth: "art"` (ART_MOUTH: a grin of teeth, a carved grin), the jaws the maw warp may move. */
export const artMouth = (parts: readonly { role?: string; mouth?: string }[]): boolean => parts.some((p) => p.role === "jaw" && p.mouth === ART_MOUTH);

/** The jaw's opaque pixels as a mask: an Rgba by alpha >= MOUTH_OPAQUE, a mask by non-zero. */
function opaqueOf(image: Rgba | Mask): Mask {
  const { width, height } = image;
  if (image.data.length !== width * height * 4) return image;
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (image.data[i * 4 + 3] ?? 0) >= MOUTH_OPAQUE ? 255 : 0;
  return { width, height, data };
}

/**
 * The rest mouth from the jaw layer's image (`image`, an Rgba or a mask the size of its bbox, placed
 * at `bbox`): `lineY` is the median of the lip line (`lipLine`) over the middle LIP_MIDDLE_SHARE of
 * the opaque columns, `cx` the midpoint of the opaque column span, `width` that span times
 * MOUTH_OF_JAW, capped at the head's width times MOUTH_OF_HEAD. Canvas px. Undefined when the jaw
 * has no opaque pixel.
 */
export function measureMouth(jaw: { bbox: Box; image: Rgba | Mask }, head?: { bbox: Box }): RigMouth | undefined {
  const top = lipLine(opaqueOf(jaw.image));
  let x0 = -1;
  let x1 = -1;
  top.forEach((y, x) => {
    if (y < 0) return;
    if (x0 < 0) x0 = x;
    x1 = x;
  });
  if (x0 < 0) return undefined;
  const span = x1 - x0 + 1;
  const trim = Math.floor((span * (1 - LIP_MIDDLE_SHARE)) / 2);
  const rows: number[] = [];
  for (let x = x0 + trim; x <= x1 - trim; x++) if ((top[x] ?? -1) >= 0) rows.push(top[x] ?? 0);
  // A jaw with a gap in its middle: the whole span's lip line.
  if (rows.length === 0) top.forEach((y) => y >= 0 && rows.push(y));
  rows.sort((a, b) => a - b);
  const mid = rows.length >> 1;
  const median = rows.length % 2 === 1 ? (rows[mid] ?? 0) : ((rows[mid - 1] ?? 0) + (rows[mid] ?? 0)) / 2;
  const [bx, by] = jaw.bbox;
  const cap = head === undefined ? Infinity : head.bbox[2] * MOUTH_OF_HEAD;
  return { cx: bx + x0 + span / 2, lineY: by + median, width: Math.min(span * MOUTH_OF_JAW, cap) };
}
