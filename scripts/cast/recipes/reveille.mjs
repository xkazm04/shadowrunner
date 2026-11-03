// Reveille's decomposition, measured from pixels (cast-forge task 5):
//   node scripts/cast/recipes/reveille.mjs
// Reads assets/characters/cast/reveille/portrait.png; writes parts.json there and the overlay
// var/cast-forge/reveille-parts.png. Smoked brass and neon: dim brass tubes with a warm halo on a
// ground of 0, a cream dial, and cyan neon (blue well above red) that tints the dial round it.
// What each measurement is:
// - figure: luma above FIGURE_T, closed; the case: a circle fitted to the ring's outer edge.
// - bell_r / bell_l: the figure above BELL_FOOT outside the case circle, each side (dome, knob and
//   stem); hammer: the figure above the case's top bracket (HAMMER_FOOT) between the bells.
// - eye_r / eye_l: the neon disc (blue - red > 5: the ring, its halo and the dark socket inside).
// - brow_r / brow_l: the dark clock hands (luma < BROW_T) beside each eye, hub filled in; pivot: the
//   hub (the hand's pixels near its inner end).
// - crack: the neon fissure (blue - red > 5) between the eyes, closed across its gaps.
// - teeth: the bright cyan zigzag in the mouth, as a band from its tips' envelope to its feet.
// - jaw: the figure (and the dark gap) below the upper dial's rim (the gap's first near-black row,
//   fitted smooth) down to the neck; its sides start at the jaw frame's own top loops (JAW_SIDE_Y).
// - key: the brass (R well above B) on the chest; pivot: the boss in the middle of the bow.
// - torso: the figure below NECK_Y; head: the rest of the figure, the bells and hammer taken out.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, components, fillHoles, fitQuadratic, grow, keepBig, luma, minus, ontoGround, or, polygonOf, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "reveille";
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

const FIGURE_T = 5;
/** The brass tubes glow onto the ground this far (px): the plate parts take their halo with them. */
const HALO_R = 9;
/** The bells end above this row (their stems meet the case ring). */
const BELL_FOOT = 250;
/** The top of the case's bracket under the hammer's stem. */
const HAMMER_FOOT = 152;
const BROW_T = 50;
/** The jaw frame's top loops, beside the mouth gap. */
const JAW_SIDE_Y = 579;
/** The mouth gap's columns (inside the hinge pillars). */
const MOUTH = [322, 702];
/** The jaw drops this share of the height (about the drawn gap again). */
const DROP = 0.03;

const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 2), 400);
const cyan = where(W, H, (i) => {
  const [r, , b] = px(i);
  return b - r > 5;
});

// The case: a circle fitted (least squares, Kasa) to the ring's outer edge on rows clear of the
// bells, the side brackets and the jaw.
const edge = [];
for (let y = 260; y < 540; y += 4) {
  if (y > 395 && y < 435) continue;
  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < W; x++) {
    if (!figure.data[y * W + x]) continue;
    if (x0 < 0) x0 = x;
    x1 = x;
  }
  if (x0 >= 0) edge.push([x0, y], [x1, y]);
}
const fitCircle = (pts) => {
  // Solve x^2 + y^2 + D x + E y + F = 0 by normal equations (3x3, Cramer).
  const S = Array.from({ length: 3 }, () => [0, 0, 0]);
  const T = [0, 0, 0];
  for (const [x, y] of pts) {
    const row = [x, y, 1];
    const z = -(x * x + y * y);
    for (let a = 0; a < 3; a++) {
      T[a] += row[a] * z;
      for (let b = 0; b < 3; b++) S[a][b] += row[a] * row[b];
    }
  }
  const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D0 = det(S);
  const [D, E, F] = [0, 1, 2].map((c) => det(S.map((row, r) => row.map((v, k) => (k === c ? T[r] : v)))) / D0);
  return { cx: -D / 2, cy: -E / 2, r: Math.sqrt((D * D + E * E) / 4 - F) };
};
const ring = fitCircle(edge);
const inCase = where(W, H, (_i, x, y) => Math.hypot(x - ring.cx, y - ring.cy) <= ring.r);

// Bells and hammer: the figure above the case.
const above = minus(clip(figure, [0, 0, W, BELL_FOOT]), inCase);
const bellR = keepBig(clip(above, [0, 0, ring.cx - 60, H]));
const bellL = keepBig(clip(above, [ring.cx + 60, 0, W, H]));
const hammer = keepBig(clip(figure, [ring.cx - 80, 0, ring.cx + 80, HAMMER_FOOT]));

// Eyes: the neon disc in each eye's box.
// The socket: the bright ring and the dark inside it, which the brows must not take.
const EYE_R_BOX = [340, 340, 470, 480];
const EYE_L_BOX = [555, 340, 690, 480];
const eye = (box) => grow(fillHoles(keepBig(close(clip(cyan, box), 2))), 3);
const socket = (box) => grow(fillHoles(keepBig(close(clip(where(W, H, (i) => px(i)[2] - px(i)[0] > 60), box), 2))), 2);
const eyes = or(socket(EYE_R_BOX), socket(EYE_L_BOX));

// Brows: the dark hand in each brow's box, the hub's brass filled in by its dark rim; the pivot is
// the hub, the mean of the hand's pixels within HUB_R px of its inner end.
const HUB_R = 14;
const BROW_RIM = 6;
const dark = where(W, H, (i) => L(i) < BROW_T);
const brow = (box, inner) => {
  // Grown BROW_RIM px: the hand's lit rim lies outside the dark core; left on the dial it is a ghost
  // outline when the hand turns (the matte keeps the rim and drops the dial).
  const hand = grow(fillHoles(keepBig(close(minus(clip(dark, box), eyes), 4))), BROW_RIM);
  let end = inner > 0 ? -1 : W;
  hand.data.forEach((v, i) => {
    if (v) end = inner > 0 ? Math.max(end, xOf(i)) : Math.min(end, xOf(i));
  });
  let [n, sx, sy] = [0, 0, 0];
  hand.data.forEach((v, i) => {
    if (!v || Math.abs(xOf(i) - end) > 2 * HUB_R) return;
    n++;
    sx += xOf(i);
    sy += yOf(i);
  });
  return { hand: minus(hand, eyes), hub: [sx / n, sy / n] };
};
const browR = brow([330, 275, 482, 385], +1);
const browL = brow([545, 275, 700, 385], -1);
// The eye discs (ring and halo) give up the hands lying over their rims: cut first, they would
// otherwise carry a piece of each hand (the matte keeps it, it differs from the plate).
const hands = grow(or(browR.hand, browL.hand), 1);
const eyeR = minus(eye(EYE_R_BOX), hands);
const eyeL = minus(eye(EYE_L_BOX), hands);

// The crack: the neon fissure between the eyes, closed across its gaps, off the eyes and brows.
// The tube glows in pieces; each piece of CRACK_MIN px or more is bridged to the next one down by a
// straight run CRACK_BRIDGE px wide, so the whole fissure is one part.
const CRACK_MIN = 30;
const CRACK_BRIDGE = 3;
const notCrack = or(grow(or(eyeR, eyeL), 2), grow(or(browR.hand, browL.hand), 2));
const pieces = (() => {
  const m = close(clip(minus(cyan, notCrack), [455, 185, 625, 540]), 2);
  const { labels, sizes } = components(m);
  const byLabel = new Map();
  labels.forEach((l, i) => {
    if (!l || sizes[l] < CRACK_MIN) return;
    const list = byLabel.get(l) ?? [];
    list.push([xOf(i), yOf(i)]);
    byLabel.set(l, list);
  });
  return [...byLabel.values()].sort((a, b) => Math.min(...a.map((p) => p[1])) - Math.min(...b.map((p) => p[1])));
})();
const bridges = [];
for (let k = 0; k + 1 < pieces.length; k++) {
  let best = [Infinity];
  for (const p of pieces[k]) for (const q of pieces[k + 1]) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best[0]) best = [d, p, q];
  }
  bridges.push([best[1], best[2]]);
}
const onBridge = where(W, H, (_i, x, y) =>
  bridges.some(([[ax, ay], [bx, by]]) => {
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    return Math.hypot(x - ax - u * (bx - ax), y - ay - u * (by - ay)) <= CRACK_BRIDGE;
  }),
);
const crackPx = where(W, H, () => false);
for (const piece of pieces) for (const [x, y] of piece) crackPx.data[y * W + x] = 1;
const crack = minus(grow(keepBig(or(crackPx, onBridge)), 4), notCrack);

// Teeth: the bright cyan zigzag, as a band from its tips' envelope (the highest tip within TIP_REACH
// px) to its feet, a few px onto the lip.
const TIP_REACH = 26;
const neon = keepBig(close(clip(where(W, H, (i) => {
  const [r, , b] = px(i);
  return b - r > 60 && b > 120;
}), [MOUTH[0], 580, MOUTH[1], 680]), 2));
const top = new Int32Array(W).fill(H);
const foot = new Int32Array(W).fill(-1);
neon.data.forEach((v, i) => {
  if (!v) return;
  top[xOf(i)] = Math.min(top[xOf(i)], yOf(i));
  foot[xOf(i)] = Math.max(foot[xOf(i)], yOf(i));
});
const envelope = (arr, x, r, pick, none) => {
  let v = none;
  for (let d = -r; d <= r; d++) if (x + d >= 0 && x + d < W && arr[x + d] !== none) v = pick(v, arr[x + d]);
  return v;
};
const teeth = grow(where(W, H, (_i, x, y) => {
  const t = envelope(top, x, TIP_REACH, Math.min, H);
  const f = envelope(foot, x, 6, Math.max, -1);
  return foot[x] >= 0 && y >= t - 3 && y <= f + 2;
}), 2);

// Jaw: the figure under the upper rim's bottom edge (the largest step down in luma), fitted smooth,
// down to the neck; at its sides it starts at the jaw frame's top loops.
const GAP_T = 10;
const rim = [];
for (let x = MOUTH[0] + 8; x < MOUTH[1] - 8; x += 2) {
  for (let y = 535; y < 600; y++) {
    if (L(y * W + x) >= GAP_T) continue;
    rim.push([x, y]);
    break;
  }
}
const lip = fitQuadratic(rim, 3);
const NECK_Y = (() => {
  let y = 700;
  while (figure.data[(y + 1) * W + Math.round(ring.cx)]) y++;
  return y;
})();
const jawTop = (x) => (x >= MOUTH[0] && x <= MOUTH[1] ? Math.round(lip(x)) : Math.max(JAW_SIDE_Y, Math.round(lip(x))));
/** Below this row the mouth's columns are the jaw frame again (under the teeth). */
const GAP_BOTTOM = 640;
const band = where(W, H, (_i, x, y) => y >= jawTop(x) && y <= NECK_Y && x > ring.cx - ring.r - 12 && x < ring.cx + ring.r + 12);
const gap = where(W, H, (_i, x, y) => x >= MOUTH[0] && x <= MOUTH[1] && y < GAP_BOTTOM);
const jaw = fillHoles(keepBig(and(band, or(figure, gap))));

// Key: brass on the chest; its pivot is the middle of the bow's widest row.
const brass = where(W, H, (i) => {
  const [r, , b] = px(i);
  return r > 30 && r - b > 25;
});
const key = grow(fillHoles(keepBig(close(clip(brass, [410, 815, 615, 985]), 4))), 2);
// The boss: the middle of the bow (the rows at least BOW_SHARE as wide as the widest), not the stem.
const BOW_SHARE = 0.6;
const spans = [];
for (let y = 815; y < 985; y++) {
  let [x0, x1] = [W, -1];
  for (let x = 410; x < 615; x++) if (key.data[y * W + x]) [x0, x1] = [Math.min(x0, x), Math.max(x1, x)];
  if (x1 >= 0) spans.push([y, x0, x1]);
}
const wide = Math.max(...spans.map(([, x0, x1]) => x1 - x0));
const bow = spans.filter(([, x0, x1]) => x1 - x0 >= BOW_SHARE * wide);
const boss = [bow.reduce((s, [, x0, x1]) => s + (x0 + x1) / 2, 0) / bow.length, bow.reduce((s, [y]) => s + y, 0) / bow.length];

const torso = fillHoles(keepBig(clip(figure, [0, NECK_Y + 1, W, H])));
const head = fillHoles(keepBig(minus(minus(figure, or(torso, jaw)), or(grow(or(bellR, bellL), 1), grow(hammer, 1)))));

const parts = [];
const at = ([x, y]) => [Math.round((y * 1000) / H), Math.round((x * 1000) / W)];
const part = (name, role, m, extra, groundR = 4) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  parts.push(toPart(name, role, polygon, W, H, extra));
};
// The neon is one circuit: eyes and teeth breathe in step; the cracked tube flickers on its own.
const glow = { pulse: { amp: 0.45, freq: 0.5, phase: 0 } };
part("crack", "pulse", crack, { matte: "plate", fill: "extend", motion: { pulse: { amp: 0.6, freq: 2, phase: 0.25 } } }, 0);
part("eye_r", "eye_r", eyeR, { matte: "plate", fill: "extend", motion: glow }, 0);
part("eye_l", "eye_l", eyeL, { matte: "plate", fill: "extend", motion: glow }, 0);
// The bells rattle (the fastest float the format carries, 2 Hz, a small turn about the stem's foot),
// out of step with each other; the hammer buzzes between them.
part("bell_r", "accessory", bellR, { follow: "head", key: false, motion: { float: { amp: [1.5, 1], freq: 2, rot_deg: 3.5, phase: 0 } } }, 5);
part("bell_l", "accessory", bellL, { follow: "head", key: false, motion: { float: { amp: [1.5, 1], freq: 1.9, rot_deg: 3.5, phase: 0.37 } } }, 5);
part("hammer", "accessory", hammer, { follow: "head", key: false, motion: { float: { amp: [2, 0], freq: 2, rot_deg: 2, phase: 0.6 } } }, 5);
// The clock-hand brows turn on their hubs, mirrored (half a cycle apart): a slow scowl.
part("brow_r", "accessory", browR.hand, { follow: "head", key: false, matte: "plate", fill: "extend", pivot: at(browR.hub), motion: { float: { amp: [0, 0], freq: 0.12, rot_deg: 6, phase: 0 } } }, 0);
part("brow_l", "accessory", browL.hand, { follow: "head", key: false, matte: "plate", fill: "extend", pivot: at(browL.hub), motion: { float: { amp: [0, 0], freq: 0.12, rot_deg: 6, phase: 0.5 } } }, 0);
part("key", "accessory", key, { follow: "torso", key: false, matte: "plate", fill: "extend", pivot: at(boss), motion: { float: { amp: [0, 0], freq: 0.2, rot_deg: 6 } } }, 0);
// The teeth ride the jaw (a second jaw-role layer with the same drop) and pulse with the eyes.
part("teeth", "jaw", teeth, { drop: DROP, cavity: "fill", fill: "extend", key: false, motion: glow }, 0);
part("jaw", "jaw", jaw, { drop: DROP, cavity: "gap", fill: "extend" });
part("head", "head", head, {}, HALO_R);
part("torso", "torso", torso, {}, HALO_R);

const file = { version: 2, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: case (${ring.cx.toFixed(1)}, ${ring.cy.toFixed(1)}) r ${ring.r.toFixed(1)}; neck ${NECK_Y}; hubs ${browR.hub.map(Math.round)} ${browL.hub.map(Math.round)}; key boss ${boss.map(Math.round)}`);
console.log(`${SLUG}: lip ${[330, 400, 512, 620, 700].map((x) => `${x}:${jawTop(x)}`).join(" ")}`);
console.log(`${SLUG}: ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
