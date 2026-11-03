// The Vicar of the Lure's decomposition, measured from pixels (cast-forge task 4):
//   node scripts/cast/recipes/vicar-of-the-lure.mjs
// Reads assets/characters/cast/vicar-of-the-lure/portrait.png; writes parts.json there and the
// overlay var/cast-forge/vicar-of-the-lure-parts.png. Leaded stained glass: every pane is ringed by
// a black lead line (luma about 5 on a ground of 1-2), so the cut lines are the lead lines.
// What each measurement is:
// - figure: luma above FIGURE_T, closed; the panes ("glass") are luma above GLASS_T.
// - lure_bulb: the magenta jewel and its halo on the ground; lure_stalk: the figure above the
//   dome's top (STALK_FOOT), the bulb taken out; the stalk's tip cap stays on the stalk.
// - eye_l / eye_r: the milky disc and its lead ring (a blink squashes both; the edit paints scales).
// - jaw: the lower lip band, the chin's bowl of grey panes and the lower teeth, under a corridor line
//   that runs between the upper teeth (on the head) and the lower teeth (on the jaw) with the fewest
//   points (`corridor`); the upper teeth stay on the head.
// - torso: the vestment and collar panes (dark blue below the chin, or below the collar's top);
//   head: the rest of the figure, the lure taken out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, components, fillHoles, grow, hull, keepBig, luma, minus, ontoGround, open, or, polyMask, polygonOf, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "vicar-of-the-lure";
const DIR = join("assets", "characters", "cast", SLUG);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const decoded = forge.decodeImage(new Uint8Array(readFileSync(join(DIR, "portrait.png"))));
if (!decoded.ok) throw new Error(decoded.errors.message);
const portrait = decoded.value;
const { width: W, height: H } = portrait;
const px = (i) => [portrait.data[i * 4], portrait.data[i * 4 + 1], portrait.data[i * 4 + 2]];
const L = (i) => luma(portrait, i);
const xOf = (i) => i % W;
const yOf = (i) => Math.floor(i / W);

const FIGURE_T = 3;
const GLASS_T = 22;
/** The dome's top: the lead line under the stalk's foot. */
const STALK_FOOT = 253;
/** The collar's top lead line. */
const COLLAR_Y = 772;
/** The mouth's corners (where the lower lip band meets the upper rim). */
const MOUTH = [283, 742];

const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 2), 400);

// Lure. The bulb: magenta (R and B well above G) in its box, then its halo on the ground.
const magenta = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r > 60 && b > 60 && g < 0.6 * Math.min(r, b);
});
const bulbCore = fillHoles(keepBig(close(clip(magenta, [560, 80, 720, 220]), 4)));
const halo = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r - g > 2 && b - g > 2 && L(i) < 60;
});
// The stalk's own glass (its tip and the cap above the jewel): the bulb's hull never takes it, or a
// sliver of the stalk would swing away with the bulb.
const stalkGlass = keepBig(minus(minus(clip(figure, [0, 0, W, STALK_FOOT]), grow(bulbCore, 1)), halo));
const bulb = minus(polyMask(W, H, hull(fillHoles(or(bulbCore, and(grow(bulbCore, 30), halo))))), grow(stalkGlass, 3));
// The stalk: its glass without the bulb's halo, then grown back over its own rim (the rim near the
// bulb is tinted by the halo; left behind it would be an orphaned fleck on the ground).
const above = minus(clip(figure, [0, 0, W, STALK_FOOT]), grow(bulb, 1));
const stalk = keepBig(and(grow(keepBig(minus(above, halo)), 4), above));

// Eyes: the milky disc (light) in each eye's box, with its lead ring.
const lightAny = where(W, H, (i) => L(i) > 150);
const eye = (box) => grow(fillHoles(keepBig(close(clip(lightAny, box), 2))), 5);
const eyeR = eye([320, 355, 395, 425]);
const eyeL = eye([630, 355, 710, 425]);

// Teeth: light low-saturation glass in the mouth, split into upper (hanging) and lower (rising).
const bone = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return L(i) > 70 && Math.max(r, g, b) - Math.min(r, g, b) < 80;
});
const mouthBox = [MOUTH[0] - 13, 430, MOUTH[1] + 14, 680];
const { labels, sizes } = components(clip(bone, mouthBox));
const stats = new Map();
labels.forEach((l, i) => {
  if (!l || sizes[l] < 15) return;
  const s = stats.get(l) ?? { n: 0, sy: 0, y0: H, y1: 0 };
  const y = yOf(i);
  s.n++;
  s.sy += y;
  s.y0 = Math.min(s.y0, y);
  s.y1 = Math.max(s.y1, y);
  stats.set(l, s);
});
/** A fragment reaching the lip band, or wider at its foot than at its tip, is a lower tooth. */
const lowerOf = (s) => {
  const lean = s.sy / s.n - (s.y0 + s.y1) / 2;
  if (s.y1 >= 600 || (s.n >= 150 && lean > 2.5)) return true;
  if (s.y0 <= 470 || (s.n >= 150 && lean < -1.5)) return false;
  return s.sy / s.n >= 540;
};
const upperBottom = new Int32Array(W).fill(-1);
const lowerTop = new Int32Array(W).fill(H);
labels.forEach((l, i) => {
  const s = stats.get(l);
  if (s === undefined) return;
  const x = xOf(i);
  if (lowerOf(s)) lowerTop[x] = Math.min(lowerTop[x], yOf(i));
  else upperBottom[x] = Math.max(upperBottom[x], yOf(i));
});

/**
 * The corridor line, from mouth corner to mouth corner: a polyline that in every column runs below
 * the upper teeth (and the rim, RIM_Y) and above the lower teeth, by MARGIN px. Greedy: each
 * segment runs as far as one straight line still fits the corridor, and ends as near the lower
 * teeth's skyline (their tips, bridged over the gaps between them: `skyline`) as that segment
 * allows; it dips only under an upper tooth that hangs below the skyline.
 */
const MARGIN = 1;
const RIM_Y = 486;
const TIP_REACH = 22;
function corridor(x0, x1) {
  const near = (arr, x, r, pick) => {
    let v = arr[x];
    for (let d = -r; d <= r; d++) v = pick(v, arr[Math.min(x1, Math.max(x0, x + d))]);
    return v;
  };
  const lo = (x) => Math.max(near(upperBottom, x, 3, Math.max), RIM_Y) + MARGIN + 1;
  const hi = (x) => near(lowerTop, x, 3, Math.min) - MARGIN;
  for (let x = x0; x <= x1; x++) if (lo(x) > hi(x)) throw new Error(`${SLUG}: teeth meet at column ${x}`);
  const skyline = (x) => Math.max(lo(x), Math.min(hi(x), near(lowerTop, x, TIP_REACH, Math.min) - MARGIN));
  const points = [[x0, hi(x0)]];
  let [sx, sy] = points[0];
  while (sx < x1) {
    let min = -Infinity;
    let max = Infinity;
    let end = sx + 1;
    for (let x = sx + 1; x <= x1; x++) {
      const a = Math.max(min, (lo(x) - sy) / (x - sx));
      const b = Math.min(max, (hi(x) - sy) / (x - sx));
      if (a > b) break;
      [min, max, end] = [a, b, x];
    }
    const want = end === x1 ? hi(x1) : skyline(end);
    const slope = Math.min(max, Math.max(min, (want - sy) / (end - sx)));
    sy += slope * (end - sx);
    sx = end;
    points.push([sx, sy]);
  }
  return points;
}
const line = corridor(MOUTH[0], MOUTH[1]);
const lineAt = new Float64Array(W).fill(NaN);
for (let k = 0; k + 1 < line.length; k++) {
  const [ax, ay] = line[k];
  const [bx, by] = line[k + 1];
  for (let x = ax; x <= bx; x++) lineAt[x] = ay + ((by - ay) * (x - ax)) / (bx - ax);
}

// The lower jaw: the grey panes of the chin's bowl (not the blue cheeks) below the line, closed
// across the lead lines, down to the collar's top; then every column of the mouth filled from the
// line down to the bowl, so the lower teeth and the throat between them go with the jaw.
const glass = where(W, H, (i) => L(i) > GLASS_T);
const below = where(W, H, (i) => !Number.isNaN(lineAt[xOf(i)]) && yOf(i) >= lineAt[xOf(i)] && yOf(i) < COLLAR_Y);
const grey = where(W, H, (i) => {
  const [r, , b] = px(i);
  return L(i) > 55 && b - r < 18;
});
const bowl = fillHoles(keepBig(close(and(grey, clip(where(W, H, (i) => yOf(i) >= 575 && yOf(i) < COLLAR_Y), [MOUTH[0], 0, MOUTH[1] + 1, H])), 6)));
const bowlTop = new Int32Array(W).fill(H);
bowl.data.forEach((v, i) => {
  if (v) bowlTop[xOf(i)] = Math.min(bowlTop[xOf(i)], yOf(i));
});
// The blue cheek panes at the mouth's corners (and their lead) stay on the head.
const cheek = grow(open(where(W, H, (i) => {
  const [r, , b] = px(i);
  return L(i) > 30 && b - r > 18;
}), 2), 3);
const jaw = fillHoles(keepBig(minus(or(and(bowl, below), and(below, where(W, H, (i) => bowlTop[xOf(i)] < H && yOf(i) <= bowlTop[xOf(i)]))), cheek)));

// Torso: vestment panes (dark blue, below the chin's rim) and everything below the collar's top.
const vestment = where(W, H, (i) => {
  const [r, , b] = px(i);
  return yOf(i) >= COLLAR_Y || (yOf(i) > 720 && L(i) < 52 && b - r > 8);
});
const torsoSeed = keepBig(and(and(glass, vestment), figure), 600);
const torso = fillHoles(keepBig(and(close(or(torsoSeed, clip(figure, [0, COLLAR_Y, W, H])), 4), minus(figure, grow(jaw, 2)))));
const head = fillHoles(keepBig(minus(minus(figure, torso), or(grow(stalk, 0), bulb))));

const parts = [];
const part = (name, role, m, extra, groundR = 4) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  parts.push(toPart(name, role, polygon, W, H, extra));
};
// The bulb glows and swings from the stalk's tip; the stalk sways about its foot on the brow, at
// the head's depth (an explicit follow), and carries the bulb with it.
part("lure_bulb", "pulse", bulb, { follow: "lure_stalk", key: false, motion: { pulse: { amp: 0.55, freq: 0.4 }, float: { amp: [0, 0], freq: 0.31, rot_deg: 5 } } }, 0);
part("eye_r", "eye_r", eyeR, {}, 0);
part("eye_l", "eye_l", eyeL, {}, 0);
part("lure_stalk", "accessory", stalk, { follow: "head", key: false, motion: { float: { amp: [0, 0], freq: 0.17, rot_deg: 4 } } }, 6);
part("jaw", "jaw", jaw, { drop: 0.035, cavity: "fill" }, 0);
part("head", "head", head);
part("torso", "torso", torso);

const file = { version: 2, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: corridor ${line.length} points; ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
