// The Redactor's decomposition, measured from pixels (cast-forge task 3):
//   node scripts/cast/recipes/the-redactor.mjs
// Reads assets/characters/cast/the-redactor/portrait.png; writes parts.json there and the overlay
// var/cast-forge/the-redactor-parts.png. 16-bit pixel art (cells about 7 px at 1024): the file
// asks for a hard cut (`cut.feather` 0) and a cavity stepped on the cell (`cut.cell` 7).
// What each measurement is:
// - figure: luma above FIGURE_T (the robe is ink black, 7-30, on a ground of 3), closed.
// - censor_bar: the figure above the head (the slab and its yellow edge line), one float+pulse part.
// - eye_l / eye_r: the yellow pinprick pupils inside the black lenses (the lenses stay on the head).
// - head: the figure above the collar's top (the face, ears and their dark shading), and below it
//   only the chin's light dither; holes (lenses, nostrils) filled.
// - jaw: the face below the mouth line (darkest row) between the mouth's corners, down to the chin.
// - inkstamp: the brass stamp below the chain's ring (gold: R and G well above B).
// - torso: the figure below the collar's top, the head taken out (collar, robe and chain).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { and, clip, close, fillHoles, grow, keepBig, minus, ontoGround, or, polygonOf, profile, toPart, uncovered, where } from "../measure.mjs";
import { partsOverlay } from "../overlay.mjs";

const SLUG = "the-redactor";
const DIR = join("assets", "characters", "cast", SLUG);
const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const decoded = forge.decodeImage(new Uint8Array(readFileSync(join(DIR, "portrait.png"))));
if (!decoded.ok) throw new Error(decoded.errors.message);
const portrait = decoded.value;
const { width: W, height: H } = portrait;
const px = (i) => [portrait.data[i * 4], portrait.data[i * 4 + 1], portrait.data[i * 4 + 2]];
const lumaOf = (i) => {
  const [r, g, b] = px(i);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** The art's pixel size at 1024 (measured: gradient energy peaks at a 6.9-7.1 px period). */
const CELL = 7;
const FIGURE_T = 5;
/** The collar's top: the torso is the figure below it (the face sits apart from it on the ground). */
const COLLAR_Y = 560;
/** Below this row is the head and body; above it, the floating bar. */
const BAR_Y = 128;

const figure = close(where(W, H, (i) => lumaOf(i) > FIGURE_T), 3);

// The bar: everything of the figure above BAR_Y (slab, its rim and the yellow edge line).
const bar = fillHoles(keepBig(close(clip(figure, [0, 0, W, BAR_Y]), 6)));

// The face: plaster white and its dither, lenses and nostrils filled in.
// Below COLLAR_Y the collar's grey rim (luma 70-90) nears the chin, so there the face is only its
// light dither (above CHIN_T).
const CHIN_T = 120;
const face = fillHoles(keepBig(close(and(where(W, H, (i, _x, y) => (y < COLLAR_Y ? lumaOf(i) > FIGURE_T : lumaOf(i) > CHIN_T)), clip(figure, [0, BAR_Y, W, H])), 2)));

// Pupils: yellow (R and G high, B low) inside each lens box, grown by a cell's worth.
const yellow = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r > 150 && g > 150 && b < 90;
});
const pupil = (box) => grow(fillHoles(keepBig(close(clip(yellow, box), 2))), 3);
const eyeR = pupil([400, 340, 480, 420]);
const eyeL = pupil([540, 340, 620, 420]);

// Jaw: the mouth line is the darkest row of the face between the mouth's corners; the jaw is the
// face under it in that span, down to the chin (where the face meets the collar).
const MOUTH = [469, 563];
const mouth = profile(portrait, MOUTH[0], MOUTH[1], () => 530, () => 560, "min");
const mouthAt = new Map(mouth.map(([x, y]) => [x, y]));
const jaw = and(face, where(W, H, (_i, x, y) => mouthAt.has(x) && y >= mouthAt.get(x)));

// The inkstamp: gold below the chain's ring.
const gold = where(W, H, (i) => {
  const [r, g, b] = px(i);
  return r > 70 && g > 55 && r - b > 35;
});
const STAMP_TOP = 838;
const inkstamp = fillHoles(keepBig(close(clip(gold, [440, STAMP_TOP, 590, 990]), 3)));

const head = face;
// The torso: the figure below the bar, the head taken out.
const torso = fillHoles(keepBig(minus(clip(figure, [0, COLLAR_Y, W, H]), grow(head, 2))));

/** Parts that meet the ground are traced a whole cell out onto it, so a 60-point outline of a stair-stepped edge never cuts a cell off (it would stay on the background as a fragment). */
const ONTO_GROUND = CELL;
const part = (name, role, m, extra, ground = true) => {
  const traced = ground ? ontoGround(m, or(figure, bar), ONTO_GROUND) : m;
  const polygon = polygonOf(traced);
  const missed = uncovered(m, polygon);
  if (missed > 0) console.log(`${SLUG}: ${name}: outline misses ${missed} px of the part`);
  return toPart(name, role, polygon, W, H, extra);
};
const parts = {
  version: 2,
  cut: { feather: 0, cell: CELL },
  parts: [
    // The bar hangs and bobs over the head, its yellow edge flickering; it is the slab that will
    // slam down over the mouth (a gesture the rig does not carry yet: see NOTES.md).
    part("censor_bar", "float", bar, { key: false, motion: { float: { amp: [0, 6], freq: 0.22, rot_deg: 0.6 }, pulse: { amp: 0.35, freq: 0.45 } } }),
    part("eye_r", "eye_r", eyeR, { fill: "extend" }, false),
    part("eye_l", "eye_l", eyeL, { fill: "extend" }, false),
    part("inkstamp", "accessory", inkstamp, { follow: "torso", key: false, motion: { float: { amp: [2, 0.5], freq: 0.35, rot_deg: 2.5 } } }),
    part("jaw", "jaw", jaw, { drop: (3 * CELL) / H, glow: "#ffd60a" }, false),
    part("head", "head", head),
    part("torso", "torso", torso),
  ],
};
const parsed = forge.parseParts(parts);
if (!parsed.ok) throw new Error(`${SLUG}: parts do not parse: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
writeFileSync(join(DIR, "parts.json"), `${JSON.stringify(parts)}\n`);
mkdirSync(join("var", "cast-forge"), { recursive: true });
writeFileSync(join("var", "cast-forge", `${SLUG}-parts.png`), forge.encodePng(partsOverlay(portrait, parts.parts)));
console.log(`${SLUG}: ${parts.parts.map((p) => `${p.name}(${p.poly.length})`).join(" ")}`);
