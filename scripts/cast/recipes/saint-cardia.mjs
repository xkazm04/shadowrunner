// Saint Cardia's decomposition, measured from pixels (cast-forge task 2.3):
//   node scripts/cast/recipes/saint-cardia.mjs
// Reads assets/characters/cast/saint-cardia/{portrait.png, fill.jpg}; writes parts.json there and
// the overlay var/cast-forge/saint-cardia-parts.png. What each measurement is:
// - crown and the five spire finials: the edit difference (|portrait - fill| > EDIT_T), the fill
//   having removed the crown; each finial is the crown above the knot where its tracery joins.
// - cage: the edit difference on the chest; heart: the saturated red inside the cage.
// - eyes: the edit difference in each eye's box (the fill painted the eyes out).
// - jaw: the lip line (darkest row between the lips) down to the chin edge (sharpest dark-going step).
// - head: the figure above the collar rim, the crown taken out; torso: the figure below the rim.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, diffMask, figureMask, fillHoles, fitQuadratic, grow, hull, keepBig, minus, open, or, ontoGround, polyMask, polygonOf, profile, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "saint-cardia";
const DIR = join("assets", "characters", "cast", SLUG);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const read = (file) => {
  const d = forge.decodeImage(new Uint8Array(readFileSync(join(DIR, file))));
  if (!d.ok) throw new Error(`${file}: ${d.errors.message}`);
  return d.value;
};
const portrait = read("portrait.png");
const fill = read("fill.jpg");
const { width: W, height: H } = portrait;

/** Mean |RGB| difference that marks a removed part; the edit's re-render noise is about 9. */
const EDIT_T = 40;
/** Top of the collar rim: the head is above it, the torso below. */
const COLLAR_Y = 606;
const edit = diffMask(portrait, fill, EDIT_T);

// Crown: the whole removed crown, then each finial above its tracery knot (x window, cut row).
// Below BAND_Y the difference also holds thin hood fold lines the edit moved; an opening drops them.
const BAND_Y = 244;
const crownRaw = clip(edit, [340, 0, 690, 362]);
const crownAll = fillHoles(keepBig(close(or(clip(crownRaw, [0, 0, W, BAND_Y]), open(clip(crownRaw, [0, BAND_Y, W, H]), 2)), 2)));
const FINIALS = [
  ["spire_1", 362, 392, 236],
  ["spire_2", 414, 444, 158],
  ["spire_3", 494, 532, 94],
  ["spire_4", 582, 612, 158],
  ["spire_5", 634, 664, 236],
];
const spires = FINIALS.map(([name, x0, x1, y]) => [name, keepBig(clip(crownAll, [x0, 0, x1, y]))]);
const crown = keepBig(minus(crownAll, spires.reduce((m, [, s]) => or(m, grow(s, 1)), where(W, H, () => false))));

// Chest: the cage (with its finials) from the edit difference, the heart from its red.
const cage = fillHoles(keepBig(close(clip(edit, [420, 630, 610, H]), 3)));
const red = where(W, H, (i) => portrait.data[i * 4] > 90 && portrait.data[i * 4] > 1.7 * portrait.data[i * 4 + 1] && portrait.data[i * 4] > 1.7 * portrait.data[i * 4 + 2]);
const heart = grow(fillHoles(keepBig(close(and(red, cage), 4))), 1);

// Eyes (character's left eye is on the image right): what the fill painted out, per eye box.
const eye = (box) => grow(polyMask(W, H, hull(keepBig(open(clip(edit, box), 1)))), 2);
const eyeR = eye([412, 352, 500, 404]);
const eyeL = eye([524, 352, 612, 404]);

// Jaw: lip line to chin edge.
const lip = profile(portrait, 470, 557, () => 470, () => 496, "min");
const chinAt = fitQuadratic(profile(portrait, 452, 574, () => 515, () => 575, "edge"));
const chin = [];
for (let x = 576; x >= 448; x -= 8) chin.push([x, chinAt(x) + 2]);
const jawPoly = [...lip.filter((_, i) => i % 3 === 0), [560, lip[lip.length - 1][1] + 6], ...chin, [466, lip[0][1] + 6]];
const jaw = polyMask(W, H, jawPoly);

const figure = figureMask(portrait, 24);
// Head and torso meet along the hood's hem: up the collar's sides to its rim, and out along the
// hem to the concave corner where the drape meets the shoulder, so the parallax step of a turned
// head falls in that corner, not across the hood's outer edge (found on the first review sheet).
const HEM = [[0, 760], [192, 752], [260, 724], [340, 700], [415, 672], [425, COLLAR_Y]];
const hemLine = [...HEM, ...HEM.map(([x, y]) => [W - x, y]).reverse()];
const above = polyMask(W, H, [[0, 0], [W, 0], ...hemLine.slice().reverse()]);
const head = fillHoles(keepBig(minus(and(figure, above), grow(crownAll, 1))));
// The torso reaches 8 px up under the head, so the seam has torso behind it.
const torso = fillHoles(keepBig(minus(figure, grow(above, -8))));

/** Parts that meet the ground are traced ONTO_GROUND px out onto it (see `ontoGround`). */
const ONTO_GROUND = 4;
const part = (name, role, m, extra, ground = true) => {
  const traced = ground ? ontoGround(m, figure, ONTO_GROUND) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`saint-cardia: ${name}: outline misses ${missed} px of the part`);
  return toPart(name, role, polygon, W, H, extra);
};
const float = (k) => ({ follow: "crown", motion: { float: { amp: [1, 3], freq: 0.25 + 0.03 * k, rot_deg: 1.5 } } });
const parts = {
  version: 2,
  parts: [
    ...spires.map(([name, m], k) => part(name, "float", m, float(k))),
    part("heart", "pulse", heart, { follow: "cage", key: false, motion: { pulse: { amp: 0.6, freq: 1.1 } } }, false),
    part("eye_r", "eye_r", eyeR, {}, false),
    part("eye_l", "eye_l", eyeL, {}, false),
    part("cage", "accessory", cage, { follow: "torso" }),
    part("crown", "crown", crown),
    part("jaw", "jaw", jaw, {}, false),
    part("head", "head", head),
    part("torso", "torso", torso),
  ],
};
const parsed = forge.parseParts(parts);
if (!parsed.ok) throw new Error(`saint-cardia: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(parts)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts.parts)));
console.log(`saint-cardia: ${parts.parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
