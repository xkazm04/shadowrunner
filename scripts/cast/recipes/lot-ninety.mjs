// Lot Ninety's decomposition, measured from pixels (cast-forge task 8):
//   node scripts/cast/recipes/lot-ninety.mjs
// Reads assets/characters/cast/lot-ninety/portrait.png; writes parts.json there and the overlay
// var/cast-forge/lot-ninety-parts.png. Art nouveau poster: flat grey-green skin, ivory gloves and
// collar, a charcoal pinstripe suit, inside black ink outlines (as dark as the ground, luma 3-4);
// the emerald accent (G - R > 60) only in the irises and the cuff flames. The ink lines are the cuts.
// What each measurement is:
// - figure: luma above FIGURE_T, closed; three blobs (the bust and the two gloves with their flames).
// - wisp_r / wisp_l: the emerald under each cuff, grown over its halo; pivot: its top middle (where
//   it leaves the cuff); a float role so it is cut before (in front of) its glove. hand_r / hand_l:
//   the glove's blob (cuff hollow filled), off the flame, closed across the rim the flame splits;
//   pivot: the middle of the glove's narrowest row above the cuff (the wrist).
// - eye_r / eye_l: the convex hull of the iris and the lid ink round it, grown EYE_GROW.
// - jaw: the lower teeth and the lower lip, from the seam between the rows of teeth (fitted) down to
//   the last row of the lower lip's dark (connected round its middle) in each column.
// - bowtie: the black bow (an opening drops the thin collar band it hangs on), over its ink.
// - collar_r / collar_l: each ivory wing (luma >= COLLAR_T, off the neck), with all the ink between
//   it and the neck.
// - hair: the head's figure above the hairline that is neither skin nor an ear, with the parting.
// - head: the figure above NECK_Y (the collar's tips aside), the face down to the chin and the neck
//   inside the collar's V, grown UNDER_COLLAR px under the wings; torso: the rest of the bust.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, components, fillHoles, fitQuadratic, grow, hull, keepBig, luma, minus, ontoGround, open, or, polyMask, polygonOf, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "lot-ninety";
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

const FIGURE_T = 20;
const INK_T = 60;
/** The ink outlines are about this wide (px). */
const INK_W = 4;
/** The cut's feather (PartsV2.cut): flat fills with ink outlines cut nearly hard (ledger, task 7). */
const FEATHER = 1;
/** Ledger 4e: an eye is grown past its iris and lids by the feather plus 3 px. */
const EYE_GROW = 4;
/** The flame's halo on the ground is about this wide. */
const HALO = 5;
/** The mouth's emerald light at about 58% of the accent (#22e07a), so the irises and flames stay brightest. */
const MOUTH_GLOW = "#14824a";
/** A showman's patter: the lower teeth and lip drop this share of the height. */
const DROP = 0.024;
/** Above this row the head is the whole figure; below it only the face (chin), the neck and their ink: the collar's back band starts here. */
const NECK_Y = 500;
const COLLAR_T = 182;
const COLLAR_SEEDS = [[430, 580], [594, 580]];
/** The hair's top is solid black ink on the ground: the head's silhouette is closed this far. */
const DOME_CLOSE = 12;
/** Gloves are traced this far onto the ground, so the outline's chords never cut a fingertip off. */
const GLOVE_GROUND = 8;

const ink = where(W, H, (i) => L(i) < INK_T);
const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 4), 400);
/** `m` grown `r` px over ink only: a part takes its own outline, never a neighbour's fill. */
const overInk = (m, r) => or(m, and(grow(m, r), ink));
/** The component of `m` holding the point [x, y]. */
const holding = (m, [x, y]) => {
  const { labels } = components(m);
  const l = labels[y * W + x];
  if (!l) throw new Error(`${SLUG}: seed ${x},${y} is not in the mask`);
  return { ...m, data: m.data.map((_, i) => (labels[i] === l ? 1 : 0)) };
};
const rowsOf = (m) => {
  const rows = new Map();
  m.data.forEach((v, i) => {
    if (!v) return;
    const r = rows.get(yOf(i)) ?? [W, -1];
    rows.set(yOf(i), [Math.min(r[0], xOf(i)), Math.max(r[1], xOf(i))]);
  });
  return rows;
};

// The emerald accent: irises and flames.
const emerald = where(W, H, (i) => {
  const [r, g] = px(i);
  return g - r > 60 && g > 80;
});

// Gloves and flames: each side's blob of the figure.
const SIDES = [
  ["r", [0, 80, 290, 760]],
  ["l", [734, 80, W, 760]],
];
const hands = SIDES.map(([side, box]) => {
  const blob = fillHoles(keepBig(clip(figure, box), 400));
  const flame = keepBig(close(and(clip(emerald, box), blob), 2), 200);
  const wisp = grow(flame, HALO);
  const rows = rowsOf(flame);
  const top = Math.min(...rows.keys());
  const [fx0, fx1] = rows.get(top + 3);
  // The flame splits the cuff's rim; closed across it, the glove is one outline (the wisp is cut first).
  const glove = fillHoles(keepBig(close(minus(blob, flame), 6), 2000));
  // The wrist: the glove's narrowest row between the knuckles and the cuff's flare.
  const grows = rowsOf(glove);
  const cuffTop = Math.min(...[...rowsOf(and(glove, where(W, H, (_i, _x, y) => y > 500))).keys()]);
  let wrist = [W, 0, 0];
  for (let y = 430; y < cuffTop + 40; y++) {
    const r = grows.get(y);
    if (r !== undefined && r[1] - r[0] < wrist[0]) wrist = [r[1] - r[0], y, (r[0] + r[1]) / 2];
  }
  return { side, glove, wisp, wispPivot: [(fx0 + fx1) / 2, top], wrist: [wrist[2], wrist[1]] };
});

// Eyes: the iris and the lid ink round it, hulled.
const irises = (() => {
  const m = keepBig(clip(emerald, [380, 240, 650, 320]), 80);
  const { labels, sizes } = components(m);
  const acc = new Map();
  labels.forEach((l, i) => {
    if (!l || sizes[l] < 80) return;
    const a = acc.get(l) ?? [0, 0, 0];
    acc.set(l, [a[0] + xOf(i), a[1] + yOf(i), a[2] + 1]);
  });
  return [...acc.values()].map(([sx, sy, n]) => [Math.round(sx / n), Math.round(sy / n)]).sort((a, b) => a[0] - b[0]);
})();
if (irises.length !== 2) throw new Error(`${SLUG}: expected two irises, found ${irises.length}`);
const EYE_BOX = [-34, -12, 36, 15];
const eyeOf = ([cx, cy], flip) => {
  const [dx0, dy0, dx1, dy1] = EYE_BOX;
  const box = flip ? [cx - dx1, cy + dy0, cx - dx0, cy + dy1] : [cx + dx0, cy + dy0, cx + dx1, cy + dy1];
  const core = keepBig(close(clip(or(ink, emerald), box), 2), 30);
  return grow(polyMask(W, H, hull(core)), EYE_GROW);
};
const eyeR = eyeOf(irises[0], false);
const eyeL = eyeOf(irises[1], true);

// The jaw: lower teeth and lower lip. The seam between the rows of teeth is the darkest row in the
// teeth band per column, fitted (the gaps between teeth are outliers the fit drops).
/** The upper teeth span this (their seam is fitted here); the jaw spans the lower lip, corner to corner. */
const TEETH = [470, 566];
const MOUTH = [436, 600];
const seamPts = [];
for (let x = TEETH[0]; x < TEETH[1]; x++) {
  let [best, at] = [Infinity, 0];
  for (let y = 436; y < 456; y++) if (L(y * W + x) < best) [best, at] = [L(y * W + x), y];
  seamPts.push([x, at]);
}
const seam = fitQuadratic(seamPts, 2);
// The lower lip: the dark (lip luma 80-115 and its ink, skin 150+) under the seam, round the lip's
// middle; with the lower teeth it holds, it runs out to the mouth's corners.
const LIP_T = 125;
const underSeam = where(W, H, (i, x, y) => x >= MOUTH[0] && x < MOUTH[1] && y >= Math.round(seam(x)) && y < seam(x) + 40);
const lipDark = holding(and(underSeam, where(W, H, (i) => L(i) < LIP_T)), [512, 470]);
const lipLast = new Int32Array(W).fill(-1);
lipDark.data.forEach((v, i) => v && (lipLast[xOf(i)] = Math.max(lipLast[xOf(i)], yOf(i))));
const jaw = and(underSeam, where(W, H, (_i, x, y) => lipLast[x] >= 0 && y <= lipLast[x] + 1));
const lipBottom = (x) => lipLast[x];
// The bow tie: the black round the knot, the thin band it hangs on opened away.
const BOW_BOX = [420, 640, 610, 745];
const BOW_KNOT = [512, 690];
const bowRaw = holding(open(fillHoles(close(clip(where(W, H, (i) => L(i) < 70), BOW_BOX), 3)), 7), BOW_KNOT);
const bowtie = overInk(bowRaw, INK_W);

// The neck: the skin inside the collar's V, under the chin.
const neck = fillHoles(holding(clip(where(W, H, (i) => L(i) > 100 && L(i) < COLLAR_T), [420, 480, 610, 680]), [512, 600]));
// The collar: the ivory round the neck, below the chin, above the bow and the lapels.
// Two wings, one each side of the neck: one part each (a polygon is one outline).
const collarRaw = close(minus(clip(where(W, H, (i) => L(i) >= COLLAR_T), [380, 500, 650, 680]), grow(neck, 2)), 2);
// A wing takes all the ink between it and the neck (its own outline): the plate under it is then
// extended from the neck's skin, which the neck reaching under the wing shows on a turn.
const wing = (seed) => minus(overInk(fillHoles(holding(collarRaw, seed)), INK_W + 3), or(neck, grow(bowtie, 1)));
const collarR = wing(COLLAR_SEEDS[0]);
const collarL = wing(COLLAR_SEEDS[1]);
const collar = or(collarR, collarL);

// Skin above the neck: the face (the parting opened off it) and both ears.
const skin = where(W, H, (i) => L(i) > 100 && L(i) < 215);
const face = fillHoles(keepBig(open(holding(clip(skin, [300, 100, 730, 570]), [512, 330]), 3)));
const ears = or(fillHoles(holding(clip(skin, [300, 240, 400, 400]), [340, 300])), fillHoles(holding(clip(skin, [630, 240, 730, 400]), [676, 300])));
const dome = and(fillHoles(close(clip(figure, [280, 0, 750, NECK_Y]), DOME_CLOSE)), where(W, H, (_i, x, y) => y < 300 || (x > 280 && x < 750)));
const headAll = fillHoles(keepBig(or(clip(or(figure, clip(dome, [0, 0, W, 300])), [280, 0, 750, NECK_Y]), and(figure, grow(or(neck, face), INK_W)))));
const hair = keepBig(open(minus(clip(headAll, [0, 0, W, 400]), overInk(or(face, ears), INK_W)), 2));
// The neck reaches UNDER_COLLAR px under the wings (the most a head moves on its torso, 12 px at full
// yaw, and a margin), above the collar band: a turned neck slides behind a wing and shows its own
// skin beside the other, never ground or a second ink edge. The collar's tips above NECK_Y are the collar's.
const UNDER_COLLAR = 16;
const BAND_Y = 645;
const head = fillHoles(keepBig(or(minus(headAll, collar), clip(and(grow(neck, UNDER_COLLAR), or(neck, collar)), [0, NECK_Y - 40, W, BAND_Y]))));
const torso = holding(minus(figure, or(head, collar)), [512, 900]);

const parts = [];
const at = ([x, y]) => [Math.round((y * 1000) / H), Math.round((x * 1000) / W)];
const part = (name, role, m, extra, groundR = 0) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  parts.push(toPart(name, role, polygon, W, H, extra));
};
// The flames lick on their own (a sway about where they leave the cuff, a flicker), and ride the glove.
hands.forEach(({ side, wisp, wispPivot }, k) =>
  part(`wisp_${side}`, "float", wisp, {
    follow: `hand_${side}`,
    fill: "extend",
    pivot: at(wispPivot),
    motion: { float: { amp: [0, 0], freq: [0.9, 0.82][k], rot_deg: 7 }, pulse: { amp: 0.45, freq: [1.3, 1.1][k] } },
  }),
);
// The gloves bob and turn about their wrists, out of step: one bidder, then the other.
hands.forEach(({ side, glove, wrist }, k) =>
  part(`hand_${side}`, "float", glove, { fill: "extend", pivot: at(wrist), motion: { float: { amp: [2, 7], freq: 0.42, rot_deg: 5, phase: [0, 0.5][k] } } }, GLOVE_GROUND),
);
part("eye_r", "eye_r", eyeR, { motion: { pulse: { amp: 0.3, freq: 0.5, phase: 0.2 } } });
// The left eye winks at the bidders on its own, once every 1 / WINK_FREQ s, shut at t = 1.7 s (the
// sheet's second frame; phase as the Tallyman's: freq * (0.075 - t), mod 1).
const WINK_FREQ = 0.12;
const winkPhase = Math.round((((WINK_FREQ * (0.075 - 1.7)) % 1) + 1) % 1 * 1000) / 1000;
part("eye_l", "eye_l", eyeL, { motion: { pulse: { amp: 0.3, freq: 0.5, phase: 0.2 }, blink: { freq: WINK_FREQ, phase: winkPhase } } });
part("bowtie", "accessory", bowtie, { follow: "torso", key: false, pivot: at(BOW_KNOT), motion: { float: { amp: [0, 0], freq: 1.1, rot_deg: 3 } } });
// Under the collar the plate is extended from the neck and the suit, not the edit (which drew its own
// collar lines there): the neck reaching under a wing is skin.
part("collar_r", "accessory", collarR, { follow: "torso", key: false, fill: "extend" }, INK_W);
part("collar_l", "accessory", collarL, { follow: "torso", key: false, fill: "extend" }, INK_W);
part("hair", "hair", hair, { follow: "head", key: false }, INK_W);
part("jaw", "jaw", jaw, { drop: DROP, glow: MOUTH_GLOW });
part("head", "head", head, {}, INK_W);
part("torso", "torso", torso, {}, INK_W);

const file = { version: 2, cut: { feather: FEATHER }, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: irises ${irises.map((p) => p.join(",")).join(" ")}; seam@512 ${seam(512).toFixed(1)} lip@512 ${lipBottom(512).toFixed(1)}; wrists ${hands.map((h) => h.wrist.map(Math.round).join(",")).join(" ")}; wisp tops ${hands.map((h) => h.wispPivot.map(Math.round).join(",")).join(" ")}`);
console.log(`${SLUG}: ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
