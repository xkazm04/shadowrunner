// Sir Vacant's decomposition, measured from pixels (cast-forge task 7):
//   node scripts/cast/recipes/sir-vacant.mjs
// Reads assets/characters/cast/sir-vacant/portrait.png; writes parts.json there and the overlay
// var/cast-forge/sir-vacant-parts.png. Naive heraldic miniature: flat pewter, rust and cream fills
// inside brown-black ink outlines (luma 0-15, as dark as the ground), star-white glow in the visor
// slits and in the gap between visor and bevor. The ink lines are the cut lines.
// What each measurement is:
// - figure: luma above FIGURE_T, closed across the ink lines; the ink itself is luma below INK_T.
// - slit_r / slit_l: the white light in each eye slit (luma > GLOW_T), grown EYE_GROW over the
//   slit's inner ink; the slit's ink frame stays on the visor.
// - bevor (jaw): from the visor's lower ink edge (its first ink row, plus the ink's width) down to
//   the bevor's own lower ink edge, between its sides: the white gap, the dark gap beside it and
//   the bevor plate (the light region round BEVOR_SEED, its breathing slits filled, grown over its
//   ink); the hinge bosses stay on the helm.
// - plume: the figure above the crest band (PLUME_FOOT); pivot: the middle of its foot.
// - pauldron_r / pauldron_l: the pewter and rust (luma > 70, or rust) in each shoulder box with
//   their spikes, grown over their ink and onto the ground.
// - tag_1..3: each cream paper (and its seal) with the short link it hangs by, up to the chain;
//   pivot: the top of that link. chain: the rust across the chest, off the tags and pauldrons.
// - head: the helm (the figure above HELM_FOOT round the middle), minus plume and bevor;
//   torso: the rest of the figure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, components, fillHoles, grow, keepBig, luma, minus, ontoGround, or, polygonOf, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "sir-vacant";
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
const none = () => where(W, H, () => false);

const FIGURE_T = 20;
const INK_T = 30;
/** The ink outlines are about this wide (px). */
const INK_W = 6;
const GLOW_T = 180;
/** The cut's feather (PartsV2.cut): a flat-fill style cuts nearly hard on its ink lines. */
const FEATHER = 1;
/**
 * The slit's light grows this far onto its ink frame (INK_W wide). Ledger 4e asks feather + 3, but
 * the extension fill reaches CUT_FEATHER (3) past the lifted region: at 4 it reached the pewter
 * beyond the ink and filled the shut slit with a brown-grey blur. At 2 the fill stays in the ink, so
 * a blink leaves the slit dark, and with a 1 px feather no light is left under the shut eye.
 */
const EYE_GROW = 2;
const PLUME_FOOT = 264;
const HELM_FOOT = 600;
const HELM_X = [360, 665];
const BEVOR_SEED = [470, 585];
/** The bevor drops this share of the height (a puppet's visor jaw; the drawn gap is about 17 px). */
const DROP = 0.02;
const ACCENT = "#f2f6ff";
/** The bevor keeps this far off the hinge bosses: its lifted region grows JAW_GROW (6) sideways plus the feather, and a lifted region under a boss left the helm's copy of the boss smeared by the extension fill. */
const BOSS_CLEAR = 8;

const ink = where(W, H, (i) => L(i) < INK_T);
const figure = keepBig(close(where(W, H, (i) => L(i) > FIGURE_T), 4), 400);
/** `m` grown `r` px over ink only: a part takes its own outline, never a neighbour's fill. */
const overInk = (m, r) => or(m, and(grow(m, r), ink));
/** The light component of `m` holding the point [x, y]. */
const holding = (m, [x, y]) => {
  const { labels } = components(m);
  const l = labels[y * W + x];
  if (!l) throw new Error(`${SLUG}: seed ${x},${y} is not in the mask`);
  return { ...m, data: m.data.map((_, i) => (labels[i] === l ? 1 : 0)) };
};

// Eyes: the white light in each slit.
const glow = where(W, H, (i) => L(i) > GLOW_T);
const slit = (box) => grow(fillHoles(keepBig(close(clip(glow, box), 2))), EYE_GROW);
const slitR = slit([400, 420, 500, 456]);
const slitL = slit([524, 420, 624, 456]);

// The bevor plate: the light region round the seed (its slits are ink holes), filled, over its ink.
const light = where(W, H, (i) => L(i) >= INK_T);
const bevorPlate = fillHoles(holding(clip(light, [380, 545, 650, 700]), BEVOR_SEED));
const bevor = overInk(bevorPlate, INK_W);
// The hinge bosses: the light discs beside the gap, which stay on the helm.
const bosses = or(holding(clip(light, [362, 515, 404, 566]), [388, 538]), holding(clip(light, [620, 515, 662, 566]), [632, 538]));
const bossesInk = overInk(bosses, INK_W);
// The lip line per column: the first row of the white gap where the column has one, else the
// visor's first ink row under the visor plate plus the ink's width (the dark gap beside the light).
const bevorCols = new Int32Array(W).fill(-1);
bevor.data.forEach((v, i) => {
  if (v) bevorCols[xOf(i)] = Math.max(bevorCols[xOf(i)], yOf(i));
});
const lip = new Int32Array(W).fill(-1);
for (let x = 0; x < W; x++) {
  if (bevorCols[x] < 0) continue;
  for (let y = 505; y < 600 && lip[x] < 0; y++) if (glow.data[y * W + x]) lip[x] = y;
  // Over the light's pointed ends the dark gap runs on above it: the lip is that gap's top.
  let s = lip[x] - 2;
  while (s > 505 && ink.data[(s - 1) * W + x]) s--;
  if (lip[x] >= 0 && lip[x] - s > INK_W + 2) lip[x] = s + INK_W;
  for (let y = 505; y < 600 && lip[x] < 0; y++) if (ink.data[y * W + x]) lip[x] = y + INK_W;
}
const jaw = minus(where(W, H, (_i, x, y) => lip[x] >= 0 && y >= lip[x] && y <= bevorCols[x]), grow(bossesInk, BOSS_CLEAR));

// The plume: the figure above the crest band; it turns about the middle of its foot.
const plumeRaw = keepBig(close(clip(where(W, H, (i) => L(i) > 12), [0, 0, W, PLUME_FOOT]), 3));
const plume = ontoGround(plumeRaw, figure, 4);

// Pauldrons with their spikes: pewter or rust in each shoulder box, off the chain.
const plateOrRust = where(W, H, (i) => {
  const [r, , b] = px(i);
  return L(i) > 70 || (r - b > 40 && L(i) > 45);
});
const rust = where(W, H, (i) => {
  const [r, , b] = px(i);
  return r - b > 40 && L(i) > 35;
});
// The chain: the rust round its middle link, end rings included (they lie against the pauldrons).
const chainRaw = holding(close(clip(rust, [305, 695, 720, 870]), 1), [512, 790]);

const pauldron = (box, seed) => fillHoles(holding(close(minus(clip(plateOrRust, box), grow(chainRaw, 2)), 3), seed));
const pauldronR = pauldron([90, 545, 380, 900], [250, 650]);
const pauldronL = pauldron([644, 545, 935, 900], [774, 650]);

// Tags: the cream paper (seal filled in), each with the link it hangs by.
const paper = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r > 150 && g > 110 && r - b > 40;
});
const papers = (() => {
  const m = keepBig(close(clip(paper, [330, 800, 700, 1000]), 3), 300);
  const { labels, sizes } = components(m);
  return [...new Set(labels.filter((l) => l && sizes[l] > 300))]
    .map((l) => ({ ...m, data: m.data.map((_, i) => (labels[i] === l ? 1 : 0)) }))
    .map((t) => fillHoles(t))
    .sort((a, b) => a.data.indexOf(1) % W - (b.data.indexOf(1) % W));
})();
if (papers.length !== 3) throw new Error(`${SLUG}: expected three tags, found ${papers.length}`);
const LINK_HALF = 12;
const LINK_LEN = 30;
const tags = papers.map((t) => {
  let [top, sx, n] = [H, 0, 0];
  t.data.forEach((v, i) => {
    if (!v) return;
    top = Math.min(top, yOf(i));
    sx += xOf(i);
    n++;
  });
  const cx = Math.round(sx / n);
  const link = clip(or(rust, ink), [cx - LINK_HALF, top - LINK_LEN, cx + LINK_HALF + 1, top + 4]);
  const m = overInk(or(t, keepBig(close(link, 2))), INK_W);
  return { m, pivot: [cx, top - LINK_LEN] };
});
const allTags = tags.reduce((a, t) => or(a, t.m), none());
const chain = overInk(fillHoles(keepBig(close(minus(chainRaw, grow(allTags, 1)), 3))), 4);

// Pauldrons over their ink (not the chain's), and onto the ground.
const pauldrons = [pauldronR, pauldronL].map((p) => minus(overInk(p, INK_W), grow(chain, 1)));

// Head and torso.
const helm = keepBig(clip(figure, [HELM_X[0], 0, HELM_X[1], HELM_FOOT]));
// The hinge bosses stand apart from the visor once the bevor is out: the helm takes them explicitly.
const head = fillHoles(keepBig(close(or(minus(helm, or(plumeRaw, jaw)), bossesInk), 3)));
const torso = keepBig(minus(figure, or(or(head, jaw), plume)));

const parts = [];
const at = ([x, y]) => [Math.round((y * 1000) / H), Math.round((x * 1000) / W)];
const part = (name, role, m, extra, groundR = 0) => {
  const traced = groundR > 0 ? ontoGround(m, figure, groundR) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  parts.push(toPart(name, role, polygon, W, H, extra));
};
// The slits are the eyes: the light narrows in a blink (over the dark slit, `fill: "extend"` from
// its ink) and flares slowly, both in step.
const flare = { pulse: { amp: 0.3, freq: 0.3, phase: 0.25 } };
part("slit_r", "eye_r", slitR, { fill: "extend", motion: flare });
part("slit_l", "eye_l", slitL, { fill: "extend", motion: flare });
// Each tag swings from its link on the chain, at its own pace.
tags.forEach(({ m, pivot }, k) =>
  part(`tag_${k + 1}`, "float", m, { follow: "chain", key: false, pivot: at(pivot), motion: { float: { amp: [0, 0], freq: [0.42, 0.5, 0.46][k], rot_deg: 4, phase: [0, 0.6, 0.66][k] } } }),
);
part("chain", "accessory", chain, { follow: "torso", key: false });
// The pauldrons rise and settle together with the breath.
pauldrons.forEach((m, k) => part(k === 0 ? "pauldron_r" : "pauldron_l", "accessory", m, { follow: "torso", key: false, motion: { float: { amp: [0, 1.5], freq: 0.2, phase: 0 } } }, INK_W));
part("plume", "hair", plume, { follow: "head", key: false, pivot: at([512, PLUME_FOOT]), motion: { float: { amp: [0, 0], freq: 0.3, rot_deg: 3 } } });
// The bevor is the jaw: dropping, it widens the lit gap above it (cavity "gap", lit by the accent).
part("bevor", "jaw", jaw, { drop: DROP, cavity: "gap", glow: ACCENT, fill: "extend" });
part("head", "head", head, {}, INK_W);
part("torso", "torso", torso, {}, INK_W);

const file = { version: 2, cut: { feather: FEATHER }, parts };
const parsed = forge.parseParts(file);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(file)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts)));
console.log(`${SLUG}: lip ${[400, 430, 470, 512, 560, 600, 625].map((x) => `${x}:${lip[x]}`).join(" ")}; tag pivots ${tags.map((t) => t.pivot.join(",")).join(" ")}`);
console.log(`${SLUG}: ${parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
