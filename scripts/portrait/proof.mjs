// The morph shader's pixel proofs (companion-lanes task 1, D), run by `capture.mjs --proof`: the
// synthetic rig of apps/web/bench/morphSynth.ts rendered by the real WebGL player at 512 px (1 rig px
// = 1 device px, t = 0 so the breath is at rest), each check measured against the same picture
// computed here. `headAt`, `coverageAt` and the constants mirror morphSynth.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SHIFT = 4;
const FEATHER = 12;
const HEAD = [56, 56, 400, 400];
const KEYS = { shift: [156, 156, 160, 120], solid: [176, 316, 120, 80], lid: [226, 176, 120, 80], big: [120, 300, 240, 120], stretch: [320, 100, 120, 120] };
// Round 2 (morphFields.ts): `big` moves the head BIG px with a back cell; `stretch` opens a gap of
// INTERIOR (reveal 1) about its middle row in its left half, and is the head inverted, unmoved, from
// 3/4 of its width on.
const BIG = 42;
const INTERIOR = [120, 20, 40];
const RED = [230, 40, 40];
const BLUE = [40, 60, 230];
const YELLOW = [250, 210, 20];
const SWAY_AMP = 20;

function headAt(x, y) {
  const gx = (((x - HEAD[0]) % 64) + 64) % 64;
  const gy = (((y - HEAD[1]) % 64) + 64) % 64;
  if (Math.hypot(gx - 32, gy - 32) < 5) return [40 + ((x * 3) & 127), 180, 90 + ((y * 5) & 127)];
  return (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? [215, 215, 215] : [60, 60, 60];
}
/** The head at a fractional x (bilinear between pixel centres, as the GPU samples). */
const headAtX = (x, y) => {
  const x0 = Math.floor(x);
  const f = x - x0;
  const a = headAt(x0, y);
  const b = headAt(x0 + 1, y);
  return a.map((v, c) => v + (b[c] - v) * f);
};
const coverageAt = (u, v, w, h) => Math.min(1, Math.max(0, Math.min(u + 0.5, v + 0.5, w - u - 0.5, h - v - 0.5) / FEATHER));

async function raw(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, at: (x, y) => Array.from(data.subarray(4 * (y * info.width + x), 4 * (y * info.width + x) + 4)) };
}

/** Mean |rendered - expected| over RGB (of 255) and the largest, over the box [x0, x1) x [y0, y1). */
function error(img, [x0, y0, x1, y1], expected) {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const got = img.at(x, y);
      const want = expected(x, y);
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(got[c] - want[c]);
        sum += d;
        max = Math.max(max, d);
        n += 1;
      }
    }
  }
  return { mean: sum / n, max };
}

/** Largest channel difference between two renders, and how many pixels differ. */
function diff(a, b, keep = () => true) {
  let max = 0;
  let changed = 0;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      if (!keep(x, y)) continue;
      const p = a.at(x, y);
      const q = b.at(x, y);
      const d = Math.max(...p.map((v, c) => Math.abs(v - q[c])));
      max = Math.max(max, d);
      if (d > 0) changed += 1;
    }
  }
  return { max, changed };
}

/** 60 % the colour, 40 % the tint (morphFields.ts `tinted`); no tint: the colour. */
const tinted = (c, tint) => (tint === undefined ? c : c.map((v, i) => 0.6 * v + 0.4 * tint[i]));
const GREEN = [0, 255, 0];
const RED_TINT = [255, 0, 0];
const BLUE_TINT = [0, 0, 255];

/** The shift s in [lo, hi] (step) that best explains the box as the head (tinted) moved right by s. */
function bestShift(img, box, lo, hi, step, tint) {
  let best = { s: NaN, mean: Infinity };
  for (let s = lo; s <= hi + 1e-9; s += step) {
    const { mean } = error(img, box, (x, y) => tinted(headAtX(x - s, y), tint));
    if (mean < best.mean) best = { s: Math.round(s * 100) / 100, mean };
  }
  return best;
}

function contrast(img, [x0, y0, x1, y1]) {
  const l = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) l.push(img.at(x, y).slice(0, 3).reduce((a, b) => a + b, 0) / 3);
  const m = l.reduce((a, b) => a + b, 0) / l.length;
  return Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length);
}

const core = ([x, y, w, h]) => [x + FEATHER, y + FEATHER, x + w - FEATHER, y + h - FEATHER];

function centroid(img, test) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < 512; y += 1) for (let x = 0; x < 512; x += 1) if (test(img.at(x, y))) [sx, sy, n] = [sx + x, sy + y, n + 1];
  return { x: sx / n, y: sy / n, n };
}

/** The turn's shift of a rest point at yaw 1, warp 1 (rig turn.ts / gl/turn.ts for this rig), plus the head's depth pan. */
function bentX(qx, qy) {
  const [rx, ry] = [96, 124.8];
  const [cx, cy] = [256, 200 + 0.15 * ry];
  const nx = (qx - cx) / (1.25 * rx);
  const ny = (qy - cy) / (1.25 * ry);
  const f = Math.max(0, 1 - nx * nx) ** 2 * Math.max(0, 1 - ny * ny) ** 2;
  return 0.25 * rx * f + 0.04 * 512 * 0.6;
}

export async function runProof({ out, port, headed, open, board }) {
  const dir = out ?? "var/companion-lanes/task1/proof";
  mkdirSync(dir, { recursive: true });
  const STATES = [
    ["base", ""],
    ["w0", "key=shift:0"],
    ["identity", "sway=0.00001,0"],
    ["shift_1", "key=shift:1"],
    ["shift_05", "key=shift:0.5"],
    ["solid_1", "key=solid_r:1"],
    ["mouth_avg", "key=solid_r:0.5,solid_b:0.5"],
    ["lid_over", "key=shift:1,lid:1"],
    ["sway", "sway=1,0"],
    ["lid_front", "key=lid:1"],
    ["lid_yaw", "yaw=22&key=lid:1"],
    ["yaw", "yaw=22"],
    ["big_1", "key=big:1"],
    ["big_05", "key=big:0.5"],
    ["stretch_03", "key=stretch:0.3"],
    ["stretch_1", "key=stretch:1"],
    ["parts_rest", "emotion=amused&speak=0"],
    ["parts_speak", "emotion=amused&shapes=openWide:1&speak=1"],
    ["gaze_alone", "gx=1"],
    ["gaze_face", "emotion=amused&gx=1&speak=0"],
  ];
  const capture = await open({ port, headed });
  const shots = {};
  let gpu = "";
  try {
    for (const [name, query] of STATES) {
      const { png, info } = await capture.shoot(`${query}&size=512`);
      gpu = `${info.mode} on ${info.gpu}`;
      writeFileSync(join(dir, `${name}.png`), png);
      shots[name] = { png, img: await raw(png) };
    }
  } finally {
    await capture.close();
  }
  await board(STATES.map(([name]) => [name, shots[name].png]), join(dir, "board.png"));
  const img = (name) => shots[name].img;
  const r = {};
  r.renderer = gpu;
  r.weight0_vs_noMorph = diff(img("w0"), img("base"));
  r.morphProgramAtIdentity_vs_base = diff(img("identity"), img("base"));
  r.shift_w1_vs_cell_core = error(img("shift_1"), core(KEYS.shift), (x, y) => headAt(x - SHIFT, y));
  r.shift_w1_base_vs_cell_core = error(img("base"), core(KEYS.shift), (x, y) => headAt(x - SHIFT, y));
  const [sx, sy, sw, sh] = KEYS.solid;
  const solidExpected = (x, y) => {
    const k = Math.round(255 * coverageAt(x - sx, y - sy, sw, sh)) / 255;
    return headAt(x, y).map((v, c) => v * (1 - k) + RED[c] * k);
  };
  r.solid_w1_vs_cell_wholeCoverage = error(img("solid_1"), [sx, sy, sx + sw, sy + sh], solidExpected);
  r.shift_w05_bestShift = bestShift(img("shift_05"), core(KEYS.shift), 0, 7.75, 0.25);
  r.shift_w05_errorAtHalf = error(img("shift_05"), core(KEYS.shift), (x, y) => headAt(x - SHIFT / 2, y));
  r.shift_w05_contrastRatio = contrast(img("shift_05"), core(KEYS.shift)) / contrast(img("base"), core(KEYS.shift));
  const avg = RED.map((v, c) => (v + BLUE[c]) / 2);
  r.twoKeysOneGroup_vs_average = error(img("mouth_avg"), core(KEYS.solid), () => avg);
  // The lid (a later group, no motion of its own) rides the face key's motion (design "Risks"):
  // inside the face key's core its colour is read at p = x - SHIFT, so its core sits SHIFT px right.
  r.laterGroup_lid_vs_yellow = error(img("lid_over"), [KEYS.lid[0] + FEATHER + SHIFT, 188, 304, 244], () => YELLOW);
  r.laterGroup_shiftBesideLid = error(img("lid_over"), [168, 168, KEYS.lid[0], 264], (x, y) => headAt(x - SHIFT, y));
  r.sway_unweightedRows = diff(img("sway"), img("base"), (_x, y) => y < 250);
  r.sway_weightedRows = diff(img("sway"), img("base"), (_x, y) => y >= 262 && y < 456);
  const swayAt = (y) => SWAY_AMP * (Math.round(255 * Math.min(1, Math.max(0, (y - HEAD[1] - 200) / 200))) / 255);
  r.sway_row408 = { measured: bestShift(img("sway"), [90, 406, 420, 411], 0, 24, 0.1), expected: Math.round(((swayAt(406) + swayAt(410)) / 2) * 100) / 100 };
  // Yaw: the lid's left and right edges per row, front and turned, against the bend of the rest
  // edge (rig turn.ts + gl/turn.ts at yaw 1, warp 1) plus the head's depth pan. Keys composited
  // after the bend (in screen space) would only pan (unbentPanDx) and keep their width.
  const yellow = (p) => p[0] > 200 && p[1] > 150 && p[2] < 100;
  const edges = (im, y) => {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < 512; x += 1) if (yellow(im.at(x, y))) [lo, hi] = [lo < 0 ? x : lo, x];
    return [lo, hi + 1];
  };
  const rows = { left: [], right: [], leftMove: [], rightMove: [] };
  for (let y = KEYS.lid[1] + FEATHER; y < KEYS.lid[1] + KEYS.lid[3] - FEATHER; y += 1) {
    const [l0, r0] = edges(img("lid_front"), y);
    const [l1, r1] = edges(img("lid_yaw"), y);
    rows.left.push(Math.abs(l1 - (l0 + bentX(l0, y + 0.5))));
    rows.right.push(Math.abs(r1 - (r0 + bentX(r0, y + 0.5))));
    rows.leftMove.push(l1 - l0);
    rows.rightMove.push(r1 - r0);
  }
  const mean = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100;
  const front = centroid(img("lid_front"), yellow);
  const turned = centroid(img("lid_yaw"), yellow);
  r.yaw_lid = {
    centroidDx: Math.round((turned.x - front.x) * 100) / 100,
    centroidDy: Math.round((turned.y - front.y) * 100) / 100,
    leftEdgeMove: mean(rows.leftMove),
    rightEdgeMove: mean(rows.rightMove),
    leftEdgeVsBend: mean(rows.left),
    rightEdgeVsBend: mean(rows.right),
    unbentPanDx: Math.round(0.04 * 512 * 0.6 * 100) / 100,
  };
  // Round 2: a large shift with a back cell, exact at weight 1 and halfway at 0.5.
  r.big_w1_vs_cell_core = error(img("big_1"), core(KEYS.big), (x, y) => headAt(x - BIG, y));
  r.big_w05_bestShift = bestShift(img("big_05"), core(KEYS.big), 0, 48, 0.5);
  r.big_w05_errorAtHalf = error(img("big_05"), core(KEYS.big), (x, y) => headAt(x - BIG / 2, y));
  r.big_w05_contrastRatio = contrast(img("big_05"), core(KEYS.big)) / contrast(img("base"), core(KEYS.big));
  // The stretch at 0.3: the share of key colour on the gap's middle rows (new surface, reveal 1)
  // and on the unmoved, unrevealed flank (head inverted), each against the base render there.
  const [tx, ty] = KEYS.stretch;
  const share = (box, key) => {
    let num = 0;
    let den = 0;
    for (let y = box[1]; y < box[3]; y += 1) {
      for (let x = box[0]; x < box[2]; x += 1) {
        const got = img("stretch_03").at(x, y);
        const base = img("base").at(x, y);
        const want = key(base);
        for (let c = 0; c < 3; c += 1) {
          num += (got[c] - base[c]) * (want[c] - base[c]);
          den += (want[c] - base[c]) ** 2;
        }
      }
    }
    return Math.round((num / den) * 1000) / 1000;
  };
  r.stretch_w03_gapShare = share([tx + 14, ty + 58, tx + 57, ty + 62], () => INTERIOR);
  r.stretch_w03_flankShare = share([tx + 92, ty + 14, tx + 107, ty + 107], (base) => base.map((v, c) => (c < 3 ? 255 - v : v)));
  r.stretch_w1_gapVsInterior = error(img("stretch_1"), [tx + 14, ty + 46, tx + 57, ty + 74], () => INTERIOR);
  // Round 3: colour apart from motion. The joy face is split in `face_up` (green) and `face_low`
  // (red), each the head moved 22 px; `look_r` (blue, gazeR) is the head moved 10 px inside face_up.
  const FACE = 22;
  const LOOK = 10;
  const up = [132, 92, 308, 168];
  const low = [132, 208, 308, 284];
  const eye = [172, 132, 268, 168];
  r.parts_speak0_low_vs_redCell = error(img("parts_rest"), low, (x, y) => tinted(headAt(x - FACE, y), RED_TINT));
  r.parts_speak1_low_bestUntintedShift = bestShift(img("parts_speak"), low, 0, 30, 0.5);
  r.parts_speak1_low_vs_redCellAtThatShift = error(img("parts_speak"), low, (x, y) => tinted(headAtX(x - r.parts_speak1_low_bestUntintedShift.s, y), RED_TINT));
  r.parts_speak1_up_vs_greenCell = error(img("parts_speak"), up, (x, y) => tinted(headAt(x - FACE, y), GREEN));
  r.gaze_alone_vs_blueCell = error(img("gaze_alone"), eye, (x, y) => tinted(headAt(x - LOOK, y), BLUE_TINT));
  r.gaze_overFace_bestGreenShift = bestShift(img("gaze_face"), eye, 0, 40, 0.5, GREEN);
  r.gaze_overFace_vs_blueAtThatShift = error(img("gaze_face"), eye, (x, y) => tinted(headAtX(x - r.gaze_overFace_bestGreenShift.s, y), BLUE_TINT));
  r.gaze_overFace_faceWithoutGaze = bestShift(img("parts_rest"), eye, 0, 40, 0.5, GREEN);
  writeFileSync(join(dir, "proof.json"), `${JSON.stringify(r, null, 2)}\n`);
  console.log(JSON.stringify(r, null, 2));
}
