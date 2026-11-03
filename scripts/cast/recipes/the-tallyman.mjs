// The Tallyman's decomposition, measured from pixels (cast-forge task 6):
//   node scripts/cast/recipes/the-tallyman.mjs
// Reads assets/characters/cast/the-tallyman/portrait.png; writes parts.json there and the overlay
// var/cast-forge/the-tallyman-parts.png. Low-poly 3D: flat-shaded grey facets, a frock barely above
// the near-black ground (luma 14-30 on 2-5), chartreuse irises, olive brass, bone beads. The facets'
// tone steps and the material colours are the cut lines.
// What each measurement is:
// - figure: luma above FIGURE_T, closed; the ground is luma 2-5.
// - eyes: each chartreuse iris (G and R high, B low) marks an eye; the eye is the convex hull of the
//   dark almond round it (luma < SOCKET_T in the eye's box, with the iris), grown EYE_GROW over the
//   lid lines. A looser threshold runs into the shadow facets beside the eye, and the edit
//   difference is ragged (the edit re-rendered the facets round each eye).
// - pince_nez: the brass (R - B > BRASS_RB, not skin-grey) between the middle and the bottom eyes.
// - jaw: the lower lip, from the lip line (darkest row between the lips, fitted) down to the shadow
//   under the lower lip (darkest row below it), between the mouth's corners.
// - beads_*: each row's left and right group of five beads, lit half and shaded half (luma > BEAD_T,
//   opened BEAD_OPEN so the rods, as thick as a bead's shade is dark, drop out), inside the frame's
//   verticals, closed across the rod between them; abacus: the brass frame and rods (R - B > BRASS_RB) round them.
// - head: the figure above NECK_Y, and the grey neck inside the collar's V (the
//   collar's own edges are the seam); collar: the frock above the shoulders' line (SHOULDER_Y);
//   torso: the rest of the figure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { clip, close, components, fillHoles, fitQuadratic, grow, hull, keepBig, luma, minus, ontoGround, open, or, polyMask, polygonOf, profile, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "the-tallyman";
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

const FIGURE_T = 9;
const SOCKET_T = 40;
const EYE_GROW = 6;
const BRASS_RB = 12;
const BEAD_T = 70;
const BEAD_OPEN = 5;
/** The beads' shaded rim lies outside the bone threshold; left on the frame it is a ghost arc when they slide. */
const BEAD_RIM = 2;
/** The neck inside the collar is lighter than the collar (luma 50+ against 20-35). */
const NECK_T = 40;
/** The lower lip's travel at full open (lips only, a prim clerk's mouth). */
const DROP = 0.014;

const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 2), 400);

// Eyes: the irises, one component each, in reading order (rows top to bottom, image left first).
const iris = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return g > 140 && r > 110 && b < 90;
});
const irises = (() => {
  const { labels, sizes } = components(iris);
  const acc = new Map();
  labels.forEach((l, i) => {
    if (!l || sizes[l] < 80) return;
    const a = acc.get(l) ?? [0, 0, 0];
    acc.set(l, [a[0] + xOf(i), a[1] + yOf(i), a[2] + 1]);
  });
  return [...acc.values()].map(([sx, sy, n]) => [sx / n, sy / n]).sort((a, b) => Math.round((a[1] - b[1]) / 30) || a[0] - b[0]);
})();
if (irises.length !== 6) throw new Error(`${SLUG}: expected six irises, found ${irises.length}`);
const EYE_HALF = [50, 24];
const eyeOf = ([cx, cy]) => {
  const box = [Math.round(cx - EYE_HALF[0]), Math.round(cy - EYE_HALF[1]), Math.round(cx + EYE_HALF[0]), Math.round(cy + EYE_HALF[1])];
  const core = keepBig(close(clip(where(W, H, (i) => L(i) < SOCKET_T || iris.data[i] === 1), box), 2));
  return grow(polyMask(W, H, hull(core)), EYE_GROW);
};
const eyes = irises.map(eyeOf);
const allEyes = eyes.reduce((m, e) => or(m, e), where(W, H, () => false));

// The pince-nez: brass between the middle and bottom rows of eyes, off the eyes.
const brass = where(W, H, (i) => {
  const [r, , b] = px(i);
  return r - b > BRASS_RB && L(i) > 30;
});
const [midL, midR] = [irises[2], irises[3]];
const PINCE_BOX = [Math.round(midL[0]), Math.round(midL[1] + 10), Math.round(midR[0]), Math.round(irises[4][1] - 4)];
// The rings are filled (the polygon is their outer edge); the plate matte keeps only the wire.
const pince = minus(grow(fillHoles(keepBig(close(clip(brass, PINCE_BOX), 3))), 2), grow(allEyes, 1));

// The jaw: the lower lip under the lip line.
const MOUTH = [456, 570];
const lipLine = profile(portrait, MOUTH[0], MOUTH[1], () => 484, () => 500, "min");
const lip = fitQuadratic(lipLine, 2);
const under = profile(portrait, 490, 534, (x) => Math.round(lip(x)) + 6, () => 514, "min");
const LIP_DEPTH = Math.round(under.reduce((s, [, y]) => s + y, 0) / under.length - lip(512)) + 1;
const jaw = where(W, H, (_i, x, y) => {
  if (x < MOUTH[0] || x >= MOUTH[1]) return false;
  const u = (2 * (x - MOUTH[0])) / (MOUTH[1] - MOUTH[0]) - 1;
  const top = Math.round(lip(x));
  return y >= top && y <= top + Math.max(2, Math.round(LIP_DEPTH * Math.sqrt(1 - u * u)));
});

// Abacus: bone beads in six groups (three rows, left and right of the middle), and the brass frame.
const ABACUS = [285, 775, 740, 930];
/** Inside the frame's verticals (they are as thick as the open keeps). */
const BEAD_SPAN = [315, 712];
const bone = keepBig(open(clip(where(W, H, (i) => L(i) > BEAD_T), [BEAD_SPAN[0], ABACUS[1], BEAD_SPAN[1], ABACUS[3]]), BEAD_OPEN), 40);
const rows = (() => {
  // Bead rows: the bone's row histogram split at its empty bands.
  const count = new Array(H).fill(0);
  bone.data.forEach((v, i) => v && count[yOf(i)]++);
  const peak = Math.max(...count);
  const bands = [];
  let start = -1;
  for (let y = ABACUS[1]; y <= ABACUS[3]; y++) {
    // The shaded bottoms nearly touch the next row's tops: split where the row is thin.
    const on = count[y] > 0.3 * peak;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      if (y - start > 12) bands.push([start, y]);
      start = -1;
    }
  }
  return bands;
})();
if (rows.length !== 3) throw new Error(`${SLUG}: expected three bead rows, found ${JSON.stringify(rows)}`);
// The rows curve (the outer beads sit higher), so each bead (a component of the opened bone) goes to
// the row whose band middle is nearest its centroid, and to the side of the middle it lies on.
const bare = (() => {
  const { labels, sizes } = components(bone);
  const centre = new Map();
  labels.forEach((l, i) => {
    if (!l) return;
    const c = centre.get(l) ?? [0, 0];
    centre.set(l, [c[0] + xOf(i) / sizes[l], c[1] + yOf(i) / sizes[l]]);
  });
  const mids = rows.map(([y0, y1]) => (y0 + y1) / 2);
  const groupOf = (l) => {
    const [cx, cy] = centre.get(l);
    const r = mids.reduce((best, m, k) => (Math.abs(cy - m) < Math.abs(cy - mids[best]) ? k : best), 0);
    return 2 * r + (cx < 512 ? 0 : 1);
  };
  return rows.flatMap((_, r) =>
    ["l", "r"].map((side, s) => [`beads_${r + 1}${side}`, fillHoles(keepBig(close(where(W, H, (i) => labels[i] > 0 && groupOf(labels[i]) === 2 * r + s), 6)))]),
  );
})();
// The rows nearly touch: a group grown over its rim (plus the cut's feather) would take the next
// row's bead tops with it, so each gives up what lies within BEAD_RIM of the other groups.
const groups = bare.map(([name, g], k) => [name, minus(grow(g, BEAD_RIM), grow(bare.filter((_, j) => j !== k).reduce((m, [, o]) => or(m, o), where(W, H, () => false)), BEAD_RIM))]);
const beads = groups.reduce((m, [, g]) => or(m, g), where(W, H, () => false));
const abacus = minus(fillHoles(keepBig(close(clip(brass, ABACUS), 3))), grow(beads, 1));

// Head and torso.
// From NECK_Y down the head is only the grey neck: the collar's top rim reaches above row 562 at
// its corners and, left on the head, rode the turned head as a dark fleck.
const NECK_Y = 540;
const head = fillHoles(keepBig(where(W, H, (i, x, y) => figure.data[i] === 1 && (y < NECK_Y || (y < 650 && x > 410 && x < 615 && L(i) > NECK_T)))));
const torso = fillHoles(keepBig(minus(figure, head)));
// The stand collar wraps the neck: in front of it in depth, so it is a front part on the torso and a
// turned neck slides behind its edges, not over them. It is the torso above the shoulders' line.
const SHOULDER_Y = 648;
const collar = clip(torso, [0, 0, W, SHOULDER_Y]);
// The torso starts under it: it still carries the collar's lifted region, and its parallax backing
// (cutNamed) reaches under the neck only from the shoulders' line, not up beside the neck.
const body = keepBig(minus(torso, collar));

const parts = [];
const part = (name, role, m, extra, groundR = 0) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  parts.push(toPart(name, role, polygon, W, H, extra));
};
// The census: the six eyes blink one at a time in reading order, BLINK_GAP s apart, once every
// 1 / BLINK_FREQ s. Phases put eye 1 shut at t = 0 and eye 6 shut at t = 1.7 s (the sheet's frames).
const BLINK_FREQ = 0.25;
const BLINK_GAP = 0.34;
const SHUT_MID = 0.075;
const phaseOf = (k) => {
  const p = BLINK_FREQ * (SHUT_MID - k * BLINK_GAP);
  return Math.round((p - Math.floor(p)) * 1000) / 1000;
};
const EYE_NAMES = ["eye_r1", "eye_l1", "eye_r2", "eye_l2", "eye_r3", "eye_l3"];
eyes.forEach((m, k) => part(EYE_NAMES[k], k % 2 === 0 ? "eye_r" : "eye_l", m, { motion: { blink: { freq: BLINK_FREQ, phase: phaseOf(k) } } }));
part("pince_nez", "monocle", pince, { follow: "head", matte: "plate", motion: { pulse: { amp: 0.5, freq: 0.25, phase: 0.6 } } });
// Beads slide along their rods, a few px, each group at its own pace: the tally never rests.
groups.forEach(([name, m], k) => part(name, "float", m, { follow: "abacus", key: false, fill: "extend", motion: { float: { amp: [4, 0], freq: Math.round(160 + 20 * k) / 1000, phase: Math.round(((0.37 * k) % 1) * 1000) / 1000 } } }));
part("abacus", "accessory", abacus, { follow: "torso", key: false });
part("collar", "accessory", collar, { follow: "torso", key: false }, 4);
// The brief's "faint chartreuse light inside the mouth": the accent at about 55%, so the irises stay the brightest.
part("jaw", "jaw", jaw, { drop: DROP, glow: "#6d8c19" });
part("head", "head", head, {}, 4);
part("torso", "torso", body, {}, 4);

const file = { version: 2, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: irises ${irises.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" ")}; bead rows ${JSON.stringify(rows)}; lip ${[460, 512, 565].map((x) => `${x}:${Math.round(lip(x))}`).join(" ")} depth ${LIP_DEPTH}`);
console.log(`${SLUG}: ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
