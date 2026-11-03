// Auntie Asp's decomposition, measured from pixels (cast-forge task 9):
//   node scripts/cast/recipes/auntie-asp.mjs
// Reads assets/characters/cast/auntie-asp/{portrait.png, fill.jpg}; writes parts.json there and the
// overlay var/cast-forge/auntie-asp-parts.png. Art nouveau poster: flat stone-grey skin and serpents,
// a charcoal cardigan, ink outlines; the molten orange accent only in her eyes and the serpents' eyes.
// What each measurement is:
// - dome: the bald scalp the fill edit painted where the serpents rise (the edit's figure above the
//   brow). It is the cut between head and serpents: each serpent's root ends ROOT_INTO px inside it.
// - serpent_*: the six components of the figure above the brow outside the dome, traced onto the
//   ground; pivot: the middle of the root (the serpent's pixels on the dome's edge).
// - eye_r / eye_l: the orange iris and its halo, grown, off the spectacles' wire.
// - spectacles: the two rings (circles fitted to the wire), filled, with the bridge and the arms up to
//   the ears (the wire's components in their zones), grown over the wire's ink.
// - jaw: the lower lip, from the seam between the lips (darkest row, fitted) to the last row of the
//   lip's own grey and the ink under it, column by column.
// - collar / collar_back_r / collar_back_l: the ruffle and the ribbed stand collar, from the frill's
//   top ink down to the stand's lower ink line (fitted), inside the cardigan's opening; the front and
//   the back band's two sides beside the neck.
// - head: the dome, the face, the ears and the neck, reaching UNDER_COLLAR px under the collar (never
//   within TRAVEL px of its outer edges); torso: the rest of the figure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, components, fillHoles, fitQuadratic, grow, keepBig, luma, minus, ontoGround, or, polyMask, polygonOf, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "auntie-asp";
const DIR = join("assets", "characters", "cast", SLUG);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const read = (file) => {
  const decoded = forge.decodeImage(new Uint8Array(readFileSync(join(DIR, file))));
  if (!decoded.ok) throw new Error(decoded.errors.message);
  return decoded.value;
};
const portrait = read("portrait.png");
const fill = read("fill.jpg");
const { width: W, height: H } = portrait;
const px = (i) => [portrait.data[i * 4], portrait.data[i * 4 + 1], portrait.data[i * 4 + 2]];
const L = (i) => luma(portrait, i);
const xOf = (i) => i % W;
const yOf = (i) => Math.floor(i / W);

const FIGURE_T = 20;
const INK_T = 60;
/** The ink outlines are about this wide (px). */
const INK_W = 4;
/** Flat fills with ink outlines cut nearly hard (ledger, task 7). */
const FEATHER = 1;
/** Ledger 4e: an eye grown past its iris by the feather plus 3 px. */
const EYE_GROW = 4;
/** Below this row nothing is a serpent: the brow. */
const BROW_Y = 350;
/** A serpent's root reaches this far inside the dome, so its outline's chords along the curved
 * scalp never leave a sliver of the root on the head. */
const ROOT_INTO = 4;
/** Serpents are traced this far onto the ground (the chords then cut no scale or tongue off). */
const SERPENT_GROUND = 8;
/** A stern librarian's shush: the lower lip drops this share of the height. */
const DROP = 0.014;
/** The neck reaches under the collar by the head's travel and a margin (ledger 4g). */
const UNDER_COLLAR = 16;

const ink = where(W, H, (i) => L(i) < INK_T);
const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 2), 400);
const overInk = (m, r) => or(m, and(grow(m, r), ink));
const holding = (m, [x, y]) => {
  const { labels } = components(m);
  const l = labels[y * W + x];
  if (!l) throw new Error(`${SLUG}: seed ${x},${y} is not in the mask`);
  return { ...m, data: m.data.map((_, i) => (labels[i] === l ? 1 : 0)) };
};
const centroid = (m) => {
  let [sx, sy, n] = [0, 0, 0];
  m.data.forEach((v, i) => v && ((sx += xOf(i)), (sy += yOf(i)), n++));
  return [sx / n, sy / n];
};

// The dome: the bald scalp of the fill edit, above the brow.
const dome = fillHoles(keepBig(clip(close(where(W, H, (i) => luma(fill, i) > 30), 3), [300, 0, W - 300, BROW_Y + 70])));

// The serpents: the figure above the brow outside the dome, six components.
const { labels: sl, sizes: ss } = components(minus(clip(figure, [0, 0, W, BROW_Y]), dome));
const serpents = ss
  .map((n, l) => [l, n])
  .filter(([l, n]) => l > 0 && n > 2000)
  .map(([l]) => {
    const body = { width: W, height: H, data: new Uint8Array(W * H).map((_, i) => (sl[i] === l ? 1 : 0)) };
    const root = and(grow(body, ROOT_INTO), dome);
    const [cx, cy] = centroid(body);
    return { body, root, pivot: centroid(and(grow(body, 2), dome)), cx, cy };
  });
if (serpents.length !== 6) throw new Error(`${SLUG}: expected six serpents, found ${serpents.length}`);
// Named by side (r = image left, the character's right) and tier from the top (1 highest).
const side = (s) => (s.cx < W / 2 ? "r" : "l");
for (const k of ["r", "l"]) serpents.filter((s) => side(s) === k).sort((a, b) => a.cy - b.cy).forEach((s, t) => (s.name = `serpent_${k}${t + 1}`));

// Eyes: the orange iris and its halo.
const orange = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r > 150 && r - b > 100 && g < r - 50;
});
const irises = (() => {
  const { labels, sizes } = components(keepBig(clip(orange, [380, BROW_Y, 650, 400]), 60));
  const acc = new Map();
  labels.forEach((l, i) => {
    if (!l || sizes[l] < 60) return;
    const a = acc.get(l) ?? [0, 0, 0];
    acc.set(l, [a[0] + xOf(i), a[1] + yOf(i), a[2] + 1]);
  });
  return [...acc.values()].map(([sx, sy, n]) => [sx / n, sy / n]).sort((a, b) => a[0] - b[0]);
})();
if (irises.length !== 2) throw new Error(`${SLUG}: expected two irises, found ${irises.length}`);

// The spectacles' rings: the circle (centre near the iris, below it: they sit low on the nose)
// on which the most wire (dark) lies.
const WIRE_T = 95;
const wire = where(W, H, (i) => L(i) < WIRE_T);
const ringOf = ([ix, iy]) => {
  let best = [-1];
  for (let cy = Math.round(iy); cy < iy + 45; cy++) {
    for (let cx = Math.round(ix) - 12; cx <= ix + 12; cx++) {
      for (let r = 30; r <= 50; r++) {
        let n = 0;
        for (let a = 0; a < 120; a++) {
          const t = (a / 120) * 2 * Math.PI;
          if (wire.data[Math.round(cy + r * Math.sin(t)) * W + Math.round(cx + r * Math.cos(t))]) n++;
        }
        if (n > best[0]) best = [n, cx, cy, r];
      }
    }
  }
  return { cx: best[1], cy: best[2], r: best[3], score: best[0] };
};
const rings = irises.map(ringOf);
const disc = ({ cx, cy, r }, extra) => polyMask(W, H, Array.from({ length: 64 }, (_, a) => [cx + (r + extra) * Math.cos((a / 64) * 2 * Math.PI), cy + (r + extra) * Math.sin((a / 64) * 2 * Math.PI)]));
const lenses = or(disc(rings[0], 3), disc(rings[1], 3));
// Bridge and arms: the wire's components touching a ring, in their zones (the ears' ink aside).
const EAR_X = [368, W - 368];
const [ra, rb] = rings;
const zone = where(W, H, (_i, x, y) => {
  const bridge = x > ra.cx && x < rb.cx && y >= ra.cy - 12 && y <= ra.cy + 4;
  const arms = ((x >= EAR_X[0] && x < ra.cx) || (x > rb.cx && x < EAR_X[1])) && y >= ra.cy - 6 && y <= ra.cy + 12;
  return bridge || arms;
});
const wireOut = minus(and(wire, zone), lenses);
const touching = (() => {
  const { labels } = components(wireOut);
  const near = grow(lenses, 2);
  const keep = new Set();
  labels.forEach((l, i) => l && near.data[i] && keep.add(l));
  return { ...wireOut, data: wireOut.data.map((_, i) => (keep.has(labels[i]) ? 1 : 0)) };
})();
const spectacles = fillHoles(or(lenses, grow(touching, 2)));
// The eyes: iris and halo, off the rings' wire (the ring's top crosses the upper lid).
const ringWire = and(wire, minus(disc(ra, 3), disc(ra, -4)));
const ringWireB = and(wire, minus(disc(rb, 3), disc(rb, -4)));
const eyeOf = (c) => {
  const iris = close(keepBig(clip(orange, [c[0] - 45, c[1] - 25, c[0] + 45, c[1] + 25])), 2);
  return or(minus(grow(iris, EYE_GROW), grow(or(ringWire, ringWireB), 1)), grow(iris, 1));
};
const eyeR = keepBig(eyeOf(irises[0]));
const eyeL = keepBig(eyeOf(irises[1]));

// The jaw: the lower lip under the seam between the lips.
const MOUTH = [462, 566];
const seamPts = [];
for (let x = MOUTH[0] + 8; x < MOUTH[1] - 8; x++) {
  let [best, at] = [Infinity, 0];
  for (let y = 498; y < 512; y++) if (L(y * W + x) < best) [best, at] = [L(y * W + x), y];
  seamPts.push([x, at]);
}
const seam = fitQuadratic(seamPts, 2);
const LIP_T = 112;
// The jaw's top runs SEAM_INK rows under the seam's darkest row: the seam's ink is the upper lip's
// lower outline and stays on the head (dropped, it drew a line across the lower lip).
const SEAM_INK = 2;
const underSeam = where(W, H, (_i, x, y) => x >= MOUTH[0] && x < MOUTH[1] && y >= Math.round(seam(x)) + SEAM_INK && y < seam(x) + 30);
const lipDark = holding(and(underSeam, where(W, H, (i) => L(i) < LIP_T)), [512, 515]);
const lipLast = new Int32Array(W).fill(-1);
lipDark.data.forEach((v, i) => v && (lipLast[xOf(i)] = Math.max(lipLast[xOf(i)], yOf(i))));
// Only where the lip has body (LIP_MIN rows under the seam): at the corners the dark is the seam's
// own ink, which dropped with the jaw would draw a second mouth line under each corner.
const LIP_MIN = 5;
const jaw = and(underSeam, where(W, H, (_i, x, y) => lipLast[x] >= seam(x) + LIP_MIN && y <= lipLast[x] + 1));

// The collar: from the ruffle's top (the highest row of its outline, the widest ink component under
// the chin, column by column; beside the neck the back band starts at BAND_Y) down to the stand's
// lower ink line (darkest row per column, fitted: the ribs are the outliers the fit drops).
const BAND_Y = 566;
const ruffleTop = (() => {
  const { labels } = components(clip(where(W, H, (i) => L(i) < 40), [395, BAND_Y - 4, 630, 650]));
  const ext = new Map();
  labels.forEach((l, i) => l && ext.set(l, [Math.min(ext.get(l)?.[0] ?? W, xOf(i)), Math.max(ext.get(l)?.[1] ?? 0, xOf(i))]));
  const [widest] = [...ext.entries()].sort((a, b) => b[1][1] - b[1][0] - (a[1][1] - a[1][0]))[0];
  const top = new Int32Array(W).fill(BAND_Y);
  for (let x = 395; x < 630; x++) {
    for (let y = BAND_Y - 4; y < 650; y++) {
      if (labels[y * W + x] !== widest) continue;
      top[x] = Math.max(BAND_Y, y);
      break;
    }
  }
  return top;
})();
const standPts = [];
for (let x = 420; x < 610; x++) {
  let [best, at] = [Infinity, 0];
  for (let y = 640; y < 700; y++) if (L(y * W + x) < best) [best, at] = [L(y * W + x), y];
  standPts.push([x, at]);
}
const stand = fitQuadratic(standPts, 3);
const opening = fillHoles(holding(close(clip(where(W, H, (i) => L(i) > 90), [380, 540, 650, 700]), 3), [512, 690]));
// It starts RUFFLE_RIM px above the frill's ink, so the ink's antialiased rim rides the collar, not the neck.
const RUFFLE_RIM = 2;
const collar = and(or(overInk(opening, INK_W), and(grow(opening, INK_W + 2), figure)), where(W, H, (_i, x, y) => y >= ruffleTop[x] - RUFFLE_RIM && y <= stand(x) + 2));

// The head: the dome, the face and ears, the neck down to the ruffle, reaching under the collar.
const serpentsAll = serpents.reduce((m, s) => or(m, s.body), where(W, H, () => false));
const faceAll = minus(and(clip(figure, [300, BROW_Y - 60, W - 300, 660]), where(W, H, (_i, x, y) => y < ruffleTop[x])), serpentsAll);
const neck = clip(faceAll, [0, 540, W, H]);
// The reach stops TRAVEL px (the head's most travel against the torso, 13 px) inside the collar's lit
// outer edges, row by row: at full yaw it stays under the band and never hangs out over the ground.
const TRAVEL = 14;
const litRows = new Map();
and(collar, where(W, H, (i) => L(i) > 90)).data.forEach((v, i) => {
  if (!v) return;
  const r = litRows.get(yOf(i)) ?? [W, 0];
  litRows.set(yOf(i), [Math.min(r[0], xOf(i)), Math.max(r[1], xOf(i))]);
});
const reach = and(and(grow(neck, UNDER_COLLAR), collar), where(W, H, (_i, x, y) => litRows.has(y) && x >= litRows.get(y)[0] + TRAVEL && x <= litRows.get(y)[1] - TRAVEL));
const head = fillHoles(keepBig(or(or(dome, faceAll), reach)));
// The torso reaches up under the collar to the neck: the collar follows it at its depth, and the
// torso's outline then needs no notch for the collar's wavy edge.
const torso = keepBig(minus(figure, head));

const parts = [];
const overlap = [];
const at = ([x, y]) => [Math.round((y * 1000) / H), Math.round((x * 1000) / W)];
/**
 * `strict`: pixels that must ride the part, all of them, rim included (a serpent's body and its 3 px
 * tongue, an eye's orange): left on the head they would stay behind as a fleck when the part moves.
 */
const part = (name, role, m, extra, groundR = 0, strict = m) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const p = toPart(name, role, polygon, W, H, extra);
  const back = polyMask(W, H, forge.toCanvas(p.poly, W, H));
  let missed = 0;
  strict.data.forEach((v, i) => v && !back.data[i] && missed++);
  const rim = uncovered(strict, forge.toCanvas(p.poly, W, H));
  if (missed > 0 || rim > 0) console.log(`${SLUG}: ${name}: outline misses ${rim} px of the part (rim aside), ${missed} px it must carry`);
  overlap.push([name, back]);
  parts.push(p);
};
part("eye_r", "eye_r", eyeR, { fill: "extend", motion: { pulse: { amp: 0.25, freq: 0.4, phase: 0.1 } } }, 0, and(eyeR, orange));
part("eye_l", "eye_l", eyeL, { fill: "extend", motion: { pulse: { amp: 0.25, freq: 0.4, phase: 0.1 } } }, 0, and(eyeL, orange));
// Traced SPECTACLES_SKIN px out over the skin (it moves with the head, as the spectacles do), so the
// outline's chords never cut the wire: hidden, the spectacles leave no wire on the face.
const SPECTACLES_SKIN = 3;
part("spectacles", "monocle", grow(overInk(spectacles, 1), SPECTACLES_SKIN), { follow: "head", key: false }, 0, and(overInk(spectacles, 1), wire));
// The serpents sway on their roots, each at its own frequency and phase: six that never move together.
// Lower tiers in front (file order within the role): nearer the face, they overlap the upper tiers.
const SWAY = {
  serpent_r3: [0.33, 0.0, 4],
  serpent_l3: [0.29, 0.55, 4],
  serpent_r2: [0.41, 0.3, 4.5],
  serpent_l2: [0.37, 0.8, 4.5],
  serpent_r1: [0.26, 0.15, 5],
  serpent_l1: [0.45, 0.65, 5],
};
for (const name of Object.keys(SWAY)) {
  const s = serpents.find((x) => x.name === name);
  const [freq, phase, rot] = SWAY[name];
  part(name, "hair", or(s.body, s.root), { follow: "head", pivot: at(s.pivot), motion: { float: { amp: [0, 0], freq, rot_deg: rot, phase } } }, SERPENT_GROUND, s.body);
}
// Three pieces (a polygon is one outline, and the plate behind differs): the front (frill and
// stand) over the edit's neck and neckline, and the back band's two sides beside the neck. The neck
// reaches under the sides, where the edit drew ground: they take `fill: "extend"` and all the ink
// between them and the neck (ledger 4g), so a turned neck slides under band-grey, never black.
// Each is traced COLLAR_SKIN px out over the neck: the chords then cut skin, never the frill's ink.
const COLLAR_SKIN = 3;
const neckCols = [...ruffleTop.keys()].filter((x) => ruffleTop[x] > BAND_Y);
const [NECK_X0, NECK_X1] = [Math.min(...neckCols), Math.max(...neckCols) + 1];
const collarPart = (name, cols, extra, skinPx = COLLAR_SKIN) => {
  const piece = and(collar, where(W, H, (_i, x) => x >= cols[0] && x < cols[1]));
  // Never above the band's top (the neck's outline there is the head's), and onto the ground here.
  const skin = and(or(piece, and(grow(piece, skinPx), neck)), where(W, H, (_i, x) => x >= cols[0] && x < cols[1]));
  const traced = and(ontoGround(skin, figure, INK_W), where(W, H, (_i, x, y) => x >= cols[0] && x < cols[1] && y >= ruffleTop[x] - RUFFLE_RIM));
  // Strict: all of it but the stand's lower line and the seams (both shared with parts that move with it).
  const inner = (_i, x, y) => y >= ruffleTop[x] && y < stand(x) - 4 && x >= cols[0] + 3 && x < cols[1] - 3;
  part(name, "accessory", traced, { follow: "torso", key: false, ...extra }, 0, and(piece, where(W, H, inner)));
};
// The pieces overlap SEAM px (the front, first in the file, keeps the overlap), so no pixel falls between.
const SEAM = 3;
collarPart("collar", [NECK_X0, NECK_X1], {});
// Keyed, so the ground they are traced over stays ground in the plate (task 9), not extension haze.
// 1 px of neck skin only on the back pieces: a turned neck leaves them, and a static strip would show.
collarPart("collar_back_r", [0, NECK_X0 + SEAM], { fill: "extend", key: true }, 1);
collarPart("collar_back_l", [NECK_X1 - SEAM, W], { fill: "extend", key: true }, 1);
part("jaw", "jaw", jaw, { drop: DROP });
// Traced 2 px over the collar (in front of it, lifted): the chords keep the neck's antialiased edge.
part("head", "head", or(head, and(grow(head, 2), collar)), {}, INK_W);
part("torso", "torso", torso, {}, INK_W);

// Every pixel of the figure is inside some outline (else it stays on the static background).
const covered = overlap.reduce((m, [, b]) => or(m, b), where(W, H, () => false));
const lost = minus(figure, covered);
const lostAt = [];
lost.data.forEach((v, i) => v && lostAt.push([xOf(i), yOf(i)]));
console.log(`${SLUG}: figure pixels in no outline: ${lostAt.length}${lostAt.length ? ` e.g. ${lostAt.slice(0, 12).map((p) => p.join(",")).join(" ")}` : ""}`);

// Serpents never overlap a neighbour's pixels (the cut order would hand them over).
for (const [name, m] of overlap.filter(([n]) => n.startsWith("serpent"))) {
  let n = 0;
  serpents.forEach((s) => s.name !== name && s.body.data.forEach((v, i) => v && m.data[i] && n++));
  if (n > 0) console.log(`${SLUG}: ${name}: outline takes ${n} px of another serpent`);
}

const file = { version: 2, cut: { feather: FEATHER }, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: irises ${irises.map((p) => p.map(Math.round).join(",")).join(" ")}; rings ${rings.map((r) => `${r.cx},${r.cy} r${r.r} (${r.score}/120)`).join(" ")}; seam@512 ${seam(512).toFixed(1)} lip@512 ${lipLast[512]}; stand@512 ${stand(512).toFixed(1)}`);
const bb = (m) => { let [a, b, c, d] = [W, H, 0, 0]; m.data.forEach((v, i) => v && ((a = Math.min(a, xOf(i))), (b = Math.min(b, yOf(i))), (c = Math.max(c, xOf(i))), (d = Math.max(d, yOf(i))))); return [a, b, c, d].join(","); };
console.log(`${SLUG}: ruffle@512 ${ruffleTop[512]} neck ${bb(neck)} collar ${bb(collar)} spectacles ${bb(spectacles)}`);
console.log(`${SLUG}: pivots ${serpents.map((s) => `${s.name} ${s.pivot.map(Math.round).join(",")}`).join("; ")}`);
console.log(`${SLUG}: ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
