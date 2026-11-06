// The non-human five's eye recipes (cast-face-pass, WP1b), each measured from that character's own
// art (repo law: never assume one character's layout holds for the cast):
// - announcer-of-dead-air `glow`: the purple-white light in the black hole is the iris (socketEyes,
//   glow look: r ~12); closed = the plate's unlit hole with a faint ember (EMBER) where the light was.
// - lantern-warden `glow`: the candle hot-spot is the iris (r 14.5 / 8.4); the socket is the carved hole
//   (the lit inner wall, CARVED_*), closed = the unlit-hole edit; tint false (the candle keeps its colour).
// - reveille `ring`: the neon ring stays the eye; its dark interior is the socket and a procedural neon
//   dot (orbArt, RING_ORB_R) in the ring's own light colour is the iris; closed = the lower-arc edit.
// - sir-vacant `slit`: the visor slit's light is the socket; the slit is dimmed (SLIT_DIM) and a white
//   orb (SLIT_ORB_R) slides in it; closed = the plate's unlit slit; tint false (white light, orange palette).
// - vicar-of-the-lure `pane`: the glass eye stays one piece (no iris, no gaze); closed = the glass-lid edit.
// `socketFive` is deterministic (the backup + the edits in var/cast-eyes/<slug>/), so eyes.mjs and
// faces.mjs read the same sockets. `faceEye` socket-reads one expression face of an eye.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resize } from "../measure.mjs";
import { area, backup, bitsWhere, centroid, componentAt, softMask, eyesWork, hexRgb, holesOf, jobDir, load, lumaOf, morph, recordedImages } from "./lib.mjs";

/** Per character: eye kind, band reach (shares of the widest eye's width), gaze tracking for the gate. */
export const RECIPES = {
  "announcer-of-dead-air": { kind: "glow", reach: {}, track: "glow" },
  // Carved holes 81 x 97 / 53 x 87: the faces recut the holes and carve brow notches ~0.4 widths above.
  // The faces recut the holes and Codex re-lights the candle at the new hole's foot (its hot spot moves
  // 4-22 px on 18 edits, 5.4 px on the no-op re-render): the candle is its own layer, so the gate asks,
  // as for rings and slits, that the face's hole still holds it (`restDrift`); the hot-spot move (`hotSpot`) is reported.
  "lantern-warden": { kind: "glow", reach: { above: 0.6 }, track: "rest", tint: false },
  // Rings 121 px wide; the clock-hand brows are their own layers (in the band by their boxes).
  reveille: { kind: "ring", reach: {}, track: "ring" },
  // Slits 66 x 16: 0.9 widths above is 60 px of steel, the whole visor plate; keep the default.
  "sir-vacant": { kind: "slit", reach: { below: 0.5 }, track: "slit", tint: false },
  // Glass discs 55 px: the glass brow ridges sit ~0.6 widths above; the maw starts ~1.4 widths below.
  "vicar-of-the-lure": { kind: "pane", reach: {}, track: "none" },
};

/** Announcer: the ember left in an unlit hole: radius (share of the light's) and peak alpha. */
export const EMBER_R = 0.5;
export const EMBER_ALPHA = 0.28;
/** Announcer: the plate's hole (luma under HOLE_LUMA, HOLE_INSET px in from its rim); the light's disc
 * (its radius + HAZE_IN) takes the median of the haze HAZE_IN..HAZE_OUT px past it, fading over HAZE_FADE px. */
export const HOLE_LUMA = 40;
export const HOLE_INSET = 1;
export const HAZE_IN = 2;
export const HAZE_OUT = 6;
export const HAZE_FADE = 2;
/** Lantern: the socket is the carved hole's layer this many px in from its cut edge. */
export const CARVED_INSET = 3;
/** Reveille: the neon tube (B - R over RING_CYAN, luma over RING_LUMA); the dot's radius (px). */
export const RING_CYAN = 70;
export const RING_LUMA = 110;
export const RING_ORB_R = 9;
/** Sir Vacant: the slit's light (luma over SLIT_LUMA), dimmed to SLIT_DIM under the orb; the orb's radius. */
export const SLIT_LUMA = 150;
export const SLIT_DIM = 0.75;
export const SLIT_ORB_R = 6.5;
/** Vicar: the milky glass disc (luma over PANE_LUMA), grown PANE_GROW px for the lid edit. */
export const PANE_LUMA = 120;
export const PANE_GROW = 2;

const crop = (forge, img, bbox) => forge.cropImage(img, bbox.map(Math.round));
const below = (forge, rig, images, layer) => crop(forge, forge.compositeRig({ ...rig, layers: rig.layers.filter((l) => l.z < layer.z) }, images), layer.bbox);

async function edit(forge, slug, name, portrait) {
  const path = join(eyesWork(slug), name);
  return existsSync(path) ? resize(await load(path), portrait.width, portrait.height) : undefined;
}

/** The ring's neon bits and its interior (the dark dial inside the ring, 1 px off the tube). */
export function ringBits(img) {
  const ring = bitsWhere(img, (r, g, b, a) => a >= 128 && b - r > RING_CYAN && 0.299 * r + 0.587 * g + 0.114 * b > RING_LUMA);
  const inside = morph(holesOf(morph(ring, img.width, img.height, 1), img.width, img.height), img.width, img.height, -1);
  return { ring, inside };
}

/**
 * `img` with the light's disc at `iris` painted over from the haze around it: each pixel takes the mean
 * of the opaque pixels HAZE_IN..HAZE_OUT px past the disc along its own angle (so the wall's or the
 * void's shading runs on across the disc), blended in over HAZE_FADE px at the rim.
 */
export function hazeFill(img, iris) {
  const { width: w, height: h } = img;
  const data = img.data.slice();
  for (let i = 0; i < w * h; i++) {
    const x = (i % w) + 0.5 - iris.cx;
    const y = Math.floor(i / w) + 0.5 - iris.cy;
    const d = Math.hypot(x, y) - iris.r;
    const k = Math.max(0, Math.min(1, 1 - (d - HAZE_IN) / HAZE_FADE));
    if (k === 0) continue;
    const a = Math.atan2(y, x);
    const sum = [0, 0, 0];
    let n = 0;
    // Where the disc meets the layer's edge (no haze along its angle), the fan widens until it finds some.
    for (const fan of [0.25, 0.75, 1.5, Math.PI]) {
      for (let t = -fan; t <= fan + 1e-9; t += fan / 4) {
        for (let r = iris.r + HAZE_IN; r <= iris.r + HAZE_OUT; r++) {
          const sx = Math.floor(iris.cx + r * Math.cos(a + t));
          const sy = Math.floor(iris.cy + r * Math.sin(a + t));
          if (sx < 0 || sy < 0 || sx >= w || sy >= h || img.data[(sy * w + sx) * 4 + 3] < 200) continue;
          for (let c = 0; c < 3; c++) sum[c] += img.data[(sy * w + sx) * 4 + c];
          n++;
        }
      }
      if (n > 0) break;
    }
    if (n === 0) continue;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c] * (1 - k) + (sum[c] / n) * k);
  }
  return { ...img, data };
}

/** Lantern: the candle's light in a hole is its pixels within CANDLE_RANGE luma of the brightest, grown CANDLE_GROW px. */
export const CANDLE_RANGE = 70;
export const CANDLE_GROW = 2;
export const INPAINT_STEPS = 400;

/**
 * `img` with the candle light inside `hole` (bits) painted out wherever the edit put it: the light's
 * pixels (CANDLE_*) are filled by diffusion from the lit wall around them (Laplace, INPAINT_STEPS
 * Jacobi steps), so the wall's shading runs smoothly across where the candle was (`seed`: only the light
 * connected to it; else every light in `hole`, which is then a face's openings only). A face of the
 * Lantern relights its candle at the foot of its recut hole; the candle the player draws is the iris layer.
 */
export function inpaintLight(img, hole, seed) {
  const { width: w, height: h } = img;
  let top = 0;
  for (let i = 0; i < w * h; i++) if (hole[i] === 1 && img.data[i * 4 + 3] >= 128) top = Math.max(top, lumaOf(img, i));
  const lit = hole.map((v, i) => (v === 1 && img.data[i * 4 + 3] >= 128 && lumaOf(img, i) >= top - CANDLE_RANGE ? 1 : 0));
  // With a seed (the base eye, whose layer also holds the pale cut rind), only the light around it.
  const own = seed === undefined ? lit : componentAt(lit, w, h, seed.cx, seed.cy);
  const core = morph(own, w, h, CANDLE_GROW).map((v, i) => v & (img.data[i * 4 + 3] >= 128 ? 1 : 0));
  const known = (i) => core[i] === 0 && img.data[i * 4 + 3] >= 128;
  const cur = [0, 1, 2].map((c) => Float32Array.from({ length: w * h }, (_, i) => img.data[i * 4 + c]));
  const todo = [...core.keys()].filter((i) => core[i] === 1);
  // Start the unknowns at the mean of the known wall so the diffusion converges from a sensible level.
  for (const ch of cur) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < w * h; i++) if (known(i)) (sum += ch[i]), n++;
    for (const i of todo) ch[i] = n === 0 ? ch[i] : sum / n;
  }
  for (let step = 0; step < INPAINT_STEPS; step++) {
    for (const ch of cur) {
      for (const i of todo) {
        const x = i % w;
        let sum = 0;
        let n = 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && img.data[j * 4 + 3] >= 128) (sum += ch[j]), n++;
        if (n > 0) ch[i] = sum / n;
      }
    }
  }
  const data = img.data.slice();
  for (const i of todo) for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(cur[c][i]);
  return { ...img, data };
}

const slitBits = (img) => bitsWhere(img, (r, g, b, a) => a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b > SLIT_LUMA);

/** Sir Vacant: a face's head patch with its slit light (a face may open the slit past the slit layer) dimmed as the slit. */
export function dimSlitLight(img) {
  return dim(img, slitBits(img), SLIT_DIM);
}

/** `img` with the pixels under `bits` scaled toward black by `k` (alpha kept). */
function dim(img, bits, k) {
  const data = img.data.slice();
  for (let i = 0; i < bits.length; i++) if (bits[i] === 1) for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c] * k);
  return { ...img, data };
}

/** An iris layer record (as socketEyes writes it) for an orb at eye-local `iris`. */
function irisLayer(forge, layer, iris, art, extra = {}) {
  const name = forge.irisName(layer.name);
  const [bx, by] = layer.bbox;
  return { name, z: layer.z, kind: "iris", file: `${name}.png`, bbox: [bx + art.box[0], by + art.box[1], art.box[2], art.box[3]], anchor: [bx + iris.cx, by + iris.cy], follow: layer.name, ...(layer.depth === undefined ? {} : { depth: layer.depth }), ...extra };
}

/** Layers in z order with each eye replaced and its iris right above it, z renumbered 1... */
function ordered(rig, changed, extra) {
  const out = [];
  for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
    out.push(changed.get(layer.name) ?? layer);
    if (extra.has(layer.name)) out.push(extra.get(layer.name));
  }
  return out.map((l, i) => ({ ...l, z: i + 1 }));
}

/**
 * The five's socketing from the recorded rig (`rig`, `images` by file, eyes as painted): { rig, files,
 * eyes, notes }. `eyes` per eye: { name, kind, original, clean, socket (bits), iris (eye-local disc),
 * socketing (socketEyes' record, glow kinds) }.
 */
export async function socketFive(forge, orbs, slug, rig, images, portrait) {
  const recipe = RECIPES[slug];
  const eyeLayers = rig.layers.filter((l) => l.kind === "eye");
  const files = {};
  const eyes = [];
  const notes = [];
  const tint = recipe.tint === false ? { tint: false } : {};
  if (recipe.kind === "glow") {
    const looks = Object.fromEntries(eyeLayers.map((l) => [l.name, "glow"]));
    const out = forge.socketEyes(rig, images, { looks });
    const closedEdit = await edit(forge, slug, "closed.png", portrait);
    // Lantern: the carved hole's wall is lit by the candle, so the eye stays a light too (socketEyes moved it to the iris).
    const lit = slug === "lantern-warden" ? { emissive: true } : {};
    const layers = out.rig.layers.map((l) => (l.kind === "eye" && l.socket !== undefined ? { ...l, ...tint, ...lit } : l.kind === "iris" ? { ...l, ...tint } : l));
    for (const e of out.eyes) {
      const layer = rig.layers.find((l) => l.name === e.name);
      let closed;
      if (slug === "announcer-of-dead-air") {
        // The plate under the eye is the unlit black hole: it is the socket (the light floats in the
        // void, not in a 13 px disc of its own glow), the light's disc is filled with the haze around
        // it, and the closed art is the hole with a faint ember where the light was.
        const plate = below(forge, rig, images, layer);
        const { width: w, height: h } = plate;
        const dark = bitsWhere(plate, (r, g, b, a, x, y) => (e.original.data[(y * w + x) * 4 + 3] ?? 0) >= 128 && lumaOf(plate, y * w + x) < HOLE_LUMA);
        const hole = componentAt(morph(dark, w, h, -HOLE_INSET), w, h, e.iris.cx, e.iris.cy);
        e.socket = hole;
        e.clean = hazeFill(e.original, e.iris);
        out.files[layer.file] = e.clean;
        out.files[forge.socketFile(e.name)] = softMask(forge, hole, w, h);
        notes.push(`${e.name}: socket = the plate's hole (${area(hole)} px), the light's disc filled with its haze`);
        const ember = orbs.lightColour(e.original) ?? hexRgb(rig.palette.eye);
        const data = plate.data.slice();
        for (let i = 0; i < plate.width * plate.height; i++) {
          const d = Math.hypot((i % plate.width) + 0.5 - e.iris.cx, Math.floor(i / plate.width) + 0.5 - e.iris.cy) / (EMBER_R * e.iris.r);
          const k = d >= 1 ? 0 : EMBER_ALPHA * (1 - d) ** 1.5;
          for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c] * (1 - k) + ember[c] * k);
        }
        closed = { ...plate, data };
        notes.push(`${e.name}: closed = the plate's unlit hole + ember (${ember.join(",")})`);
      } else if (slug === "lantern-warden") {
        // The candle lights the whole carved hole: the socket is the hole (the eye layer, CARVED_INSET px
        // in from the cut rind), the candle's disc filled with the lit wall around it.
        const { width: w, height: h } = e.original;
        const hole = morph(bitsWhere(e.original, (r, g, b, a) => a >= 200), w, h, -CARVED_INSET);
        e.socket = hole;
        e.clean = inpaintLight(e.original, hole, e.iris);
        out.files[layer.file] = e.clean;
        out.files[forge.socketFile(e.name)] = softMask(forge, hole, w, h);
        notes.push(`${e.name}: socket = the carved hole (${area(hole)} px), the candle's light painted out (inpaintLight)`);
      }
      if (slug !== "announcer-of-dead-air" && closedEdit !== undefined) {
        closed = crop(forge, closedEdit, layer.bbox);
        notes.push(`${e.name}: closed = the unlit-hole edit`);
      } else if (closed === undefined) notes.push(`${e.name}: closed = socketEyes' ${e.closedFrom} (no closed.png yet)`);
      if (closed !== undefined) out.files[forge.closedFile(e.name)] = forge.featherClosed(e.original, closed, e.socket);
      eyes.push({ name: e.name, kind: "glow", original: e.original, clean: e.clean, socket: e.socket, iris: e.iris, socketing: e, haze: true, inpaint: slug === "lantern-warden" });
    }
    notes.push(...out.notes);
    return { rig: { ...out.rig, layers }, files: out.files, eyes, notes };
  }
  const changed = new Map();
  const extra = new Map();
  const closedEdit = recipe.kind === "slit" ? undefined : await edit(forge, slug, "closed.png", portrait);
  for (const layer of eyeLayers) {
    const eye = images[layer.file];
    const { width: w, height: h } = eye;
    if (recipe.kind === "pane") {
      const disc = morph(bitsWhere(eye, (r, g, b, a, x, y) => a >= 128 && lumaOf(eye, y * w + x) > PANE_LUMA), w, h, PANE_GROW);
      if (closedEdit === undefined) {
        notes.push(`${layer.name}: one piece, no closed.png yet`);
        continue;
      }
      files[forge.closedFile(layer.name)] = forge.featherClosed(eye, crop(forge, closedEdit, layer.bbox), disc);
      changed.set(layer.name, { ...layer, closed: forge.closedFile(layer.name) });
      eyes.push({ name: layer.name, kind: "pane", original: eye, clean: eye, socket: disc });
      notes.push(`${layer.name}: one piece; closed = the glass-lid edit over the disc (${area(disc)} px)`);
      continue;
    }
    if (recipe.kind === "ring") {
      const { ring, inside } = ringBits(eye);
      const c = centroid(inside, w);
      const iris = { cx: c.cx, cy: c.cy, r: RING_ORB_R };
      const rgb = orbs.lightColour(eye, ring) ?? hexRgb(rig.palette.eye);
      const art = orbs.orbArt(iris, { rgb });
      files[`${forge.irisName(layer.name)}.png`] = art.image;
      files[forge.socketFile(layer.name)] = softMask(forge, inside, w, h);
      const whole = morph(holesOf(ring, w, h).map((v, i) => v | ring[i]), w, h, 3);
      if (closedEdit !== undefined) files[forge.closedFile(layer.name)] = forge.featherClosed(eye, crop(forge, closedEdit, layer.bbox), whole);
      // The ring stays the lit neon (its pulse kept); the dot is lit with the same pulse.
      // A socketed eye gives no light unless it says so (rig isEmissive): the neon ring is the light.
      changed.set(layer.name, { ...layer, emissive: true, socket: forge.socketFile(layer.name), ...(closedEdit === undefined ? {} : { closed: forge.closedFile(layer.name) }) });
      extra.set(layer.name, irisLayer(forge, layer, iris, art, layer.motion?.pulse === undefined ? {} : { motion: { pulse: layer.motion.pulse } }));
      eyes.push({ name: layer.name, kind: "ring", original: eye, clean: eye, socket: inside, iris, ring });
      notes.push(`${layer.name}: ring socket ${area(inside)} px at ${(layer.bbox[0] + c.cx).toFixed(1)},${(layer.bbox[1] + c.cy).toFixed(1)}; dot r ${RING_ORB_R} rgb ${rgb.join(",")}; closed ${closedEdit === undefined ? "none yet" : "lower-arc edit"}`);
      continue;
    }
    // slit
    const socket = slitBits(eye);
    const c = centroid(socket, w);
    const iris = { cx: c.cx, cy: c.cy, r: SLIT_ORB_R };
    const rgb = orbs.lightColour(eye, socket) ?? [242, 246, 255];
    const art = orbs.orbArt(iris, { rgb, hot: 1 });
    files[layer.file] = dim(eye, socket, SLIT_DIM);
    files[`${forge.irisName(layer.name)}.png`] = art.image;
    files[forge.socketFile(layer.name)] = softMask(forge, socket, w, h);
    files[forge.closedFile(layer.name)] = forge.featherClosed(eye, below(forge, rig, images, layer), socket);
    // The slit's light stays lit (a socketed eye is unlit unless it says so), white (tint false).
    changed.set(layer.name, { ...layer, emissive: true, socket: forge.socketFile(layer.name), closed: forge.closedFile(layer.name), tint: false });
    extra.set(layer.name, irisLayer(forge, layer, iris, art, { tint: false, ...(layer.motion?.pulse === undefined ? {} : { motion: { pulse: layer.motion.pulse } }) }));
    eyes.push({ name: layer.name, kind: "slit", original: eye, clean: files[layer.file], socket, iris });
    notes.push(`${layer.name}: slit socket ${area(socket)} px, centre ${(layer.bbox[0] + c.cx).toFixed(1)},${(layer.bbox[1] + c.cy).toFixed(1)}; orb r ${SLIT_ORB_R} rgb ${rgb.join(",")}; slit dimmed to ${SLIT_DIM}; closed = the plate's unlit slit`);
  }
  return { rig: { ...rig, layers: extra.size === 0 && changed.size === 0 ? rig.layers : ordered(rig, changed, extra) }, files, eyes, notes };
}

/**
 * One expression face of an eye (`face`: the eye patch's image, the layer's bbox): { image, socket
 * (Rgba mask) | undefined, narrowed, drift }. Glow eyes go through socketVariant; rings and slits
 * read their opening again; panes stay one piece.
 */
export function faceEye(forge, eye, face) {
  const { width: w, height: h } = face;
  if (eye.kind === "glow") {
    const sv = forge.socketVariant({ ...eye.socketing, socket: eye.socket, clean: eye.clean }, face);
    const v = { ...sv, socket: softMask(forge, forge.imageToBits(sv.socket), w, h) };
    if (!eye.haze) return v;
    // The void's faces: the light's disc filled with its haze again, where the face's light now sits.
    const again = forge.measureIris(face, { look: "glow", ...(eye.socketing.cues.tint === undefined ? {} : { tint: eye.socketing.cues.tint }) });
    if (eye.inpaint) return v;
    return { ...v, image: hazeFill(face, again === undefined ? eye.iris : { ...again, r: eye.iris.r }) };
  }
  if (eye.kind === "pane") return { image: face, socket: undefined, narrowed: false, drift: "none" };
  if (eye.kind === "ring") {
    // As a slit: the dot is its own layer at the ring's centre; a face reshapes the ring, and what must
    // hold is that the face's interior still holds the dot's rest place (`restDrift`).
    const { inside } = ringBits(face);
    const narrowed = area(inside) < forge.NARROW_SHARE * area(eye.socket);
    return { image: face, socket: softMask(forge, inside, w, h), narrowed, drift: restDrift(inside, w, eye.iris, narrowed) };
  }
  // A slit has no gaze to drift: the orb is its own layer at the slit's centre. A face reshapes the
  // slit (wedges, crescents, thin lines); what must hold is that its light still holds the orb's rest
  // place: the drift is the distance (px) from the orb's centre to the face's nearest lit pixel.
  const socket = slitBits(face);
  const narrowed = area(socket) < forge.NARROW_SHARE * area(eye.socket);
  return { image: dim(face, socket, SLIT_DIM), socket: softMask(forge, socket, w, h), narrowed, drift: restDrift(socket, w, eye.iris, narrowed) };
}

/**
 * For an orb that is its own layer (rings, slits): px from the orb's rest centre to the face's nearest
 * open pixel (0 inside). A narrowed opening that no longer reaches it hides it, as lowered lids hide an
 * iris (faceStability's "unsure").
 */
export function restDrift(open, w, iris, narrowed) {
  let near = Infinity;
  for (let i = 0; i < open.length; i++) if (open[i] === 1) near = Math.min(near, Math.hypot((i % w) + 0.5 - iris.cx, Math.floor(i / w) + 0.5 - iris.cy));
  return near === Infinity || (narrowed && near > 0.71) ? "unsure" : Math.max(0, near - 0.71);
}

/** Lantern: the candle's hot spot, the centroid of the pixels within HOT_RANGE luma of the brightest. */
export const HOT_RANGE = 12;
export function hotSpot(img) {
  let top = 0;
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] >= 128) top = Math.max(top, lumaOf(img, i));
  return centroid(bitsWhere(img, (r, g, b, a, x, y) => a >= 128 && lumaOf(img, y * img.width + x) >= top - HOT_RANGE), img.width);
}

/** The backup (lib.mjs `backup`) and `socketFive` on it: { orig, portrait, images, rig, files, eyes, notes }. */
export async function socketed(forge, orbs, slug) {
  const orig = backup(slug);
  const images = await recordedImages(slug, orig.value.rig);
  const portrait = await load(join(jobDir(slug), orig.value.portrait));
  return { orig, portrait, images, ...(await socketFive(forge, orbs, slug, orig.value.rig, images, portrait)) };
}
