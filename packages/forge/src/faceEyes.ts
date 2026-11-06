// Socketed eyes for a rig (face-control, WP-B): `socketEyes` turns each eye layer of an assembled
// rig into an iris-free eye with its socket mask and closed-lid art plus an iris layer (kind "iris",
// following the eye, emissive when the eye gave light: the glow moves to the iris), from the eye's
// own pixels (eyes.ts, eyeArt.ts) and, for white eyes, the iris-free edit of the portrait. An eye it
// is unsure of stays one painted piece. `socketVariant` does the same for one expression face of an
// eye: its iris found again, its own socket, `narrowed` when the lids close in, the iris painted out.
// The cast (scripts/cast/eyes.mjs, expressions.mjs) and the live forge share both. Pure.
import { isEmissive, type Layer, type Rig } from "@sr/rig";
import { cleanEye, closedArt, featherClosed, irisImage, type IrisArt } from "./eyeArt.js";
import { fillHoles, growBits, inscribedDisc, keepComponent } from "./eyeBits.js";
import { bitsToImage, eyeballColour, inDisc, measureIris, medianColour, openingBits, scleraColour, socketBits, type EyeCues, type EyeLook, type Iris } from "./eyes.js";
import { lightColour, orbArt, type OrbStyle } from "./eyeOrb.js";
import { compositeRig } from "./composite.js";
import { IRIS_DRIFT_LIMIT, TRACK_GAIN, TRACK_UNSURE, cropImage, trackIris } from "./stability.js";
import type { Rgba } from "./types.js";

/** A face's lid opening under this share of the base's area is `narrowed` (mood squint adds none). */
export const NARROW_SHARE = 0.8;
/** A face pixel shows iris when within this RGB distance of the base iris pixel it moved from. */
export const IRIS_MATCH = 40;
/** How far past the base's opening (share of its height) a face's opening may reach. */
export const SOCKET_GROW = 0.15;
/** A face pixel within this RGB distance of the eye as painted is unchanged (the re-render's own drift). */
export const SAME_DIST = 50;

/** The iris layer's name for an eye layer: `eye_l` -> `iris_l`, else `<eye>_iris`. */
export const irisName = (eye: string): string => (/^eye(_|$)/.test(eye) ? eye.replace(/^eye/, "iris") : `${eye}_iris`);
export const socketFile = (name: string): string => `${name}.socket.png`;
export const closedFile = (name: string): string => `${name}.closed.png`;

/** What one socketed eye was made from, for its expression faces. */
export interface EyeSocketing {
  name: string;
  look: EyeLook;
  /** The eye as painted (with its iris), the iris-free eye, the socket bits; eye-local. */
  original: Rgba;
  clean: Rgba;
  socket: Uint8Array;
  iris: Iris;
  cues: EyeCues;
  /** Where the closed-lid art came from: the closed-eyes edit, the plate under the eye, the lid drawn down, or the recipe. */
  closedFrom: "edit" | "plate" | "painted lids" | "recipe";
  /** cast-face-pass: the iris-free eye came from the recipe; a face paints its iris out with the base's (`socketVariant`). */
  ownClean?: true;
}

export interface SocketedRig {
  rig: Rig;
  /** New or replaced files by name (the eye layers' files hold the iris-free eyes). */
  files: Record<string, Rgba>;
  eyes: EyeSocketing[];
  /** One line per eye: socketed (and how) or why it stayed one piece. */
  notes: string[];
}

export interface SocketOptions {
  /** The iris-free edit of the portrait (canvas size): the openings of every eye, the whites of white eyes. */
  clean?: Rgba;
  /** A closed-eyes edit of the portrait (canvas size): the closed-lid art when it reads as lid (else the plate). */
  closed?: Rgba;
  /** A mask edit of the portrait (canvas size): openings green, irises magenta (`markOf`); the cast's. */
  marks?: Rgba;
  /** Per eye layer name, how it is drawn; default: glow (then white) for an eye that gives light, else white. */
  looks?: Readonly<Record<string, EyeLook>>;
  /** cast-face-pass: per eye layer name, what the character's recipe gives instead of a measure (`EyeRecipe`). */
  eyes?: Readonly<Record<string, EyeRecipe>>;
}

/**
 * cast-face-pass: a character's own answer for one eye, over what `socketEyes` would measure. Every
 * field is optional; eye-local px, images the eye layer's size unless said otherwise.
 */
export interface EyeRecipe {
  /** The lid opening (a lens interior, a carved hole, a slit): replaces the measured socket. */
  socket?: Uint8Array;
  /** The iris disc: replaces the measured one (with `socket` too, nothing is measured). */
  iris?: Iris;
  /** A procedural glow orb as the iris art (`orbArt`) of radius `r` (default the iris's), in `rgb` or the eye's own light (`lightColour`). */
  orb?: Partial<OrbStyle> & { r?: number };
  /** Ready iris art (eye-local box), e.g. a pixel pupil cut whole. */
  irisArt?: IrisArt;
  /** The iris-free eye: replaces `cleanEye`. */
  clean?: Rgba;
  /** The closed art (eye-size): replaces the closed-eyes edit and the plate (laid in around the socket by `featherClosed`). */
  closed?: Rgba;
  /** No socket and no iris: the eye stays one piece and gains `closed` (laid in whole), its motion kept. Needs `closed`. */
  closedOnly?: true;
  /** The eye and its iris keep the art's own light colour (Layer.tint false). */
  tint?: false;
}

/** The orb fallback's radius: this share of the opening's largest inscribed disc, at most ORB_HEIGHT_SHARE of the eye's height. */
export const ORB_OF_SOCKET = 0.7;
export const ORB_HEIGHT_SHARE = 0.3;

/**
 * cast-face-pass, the procedural orb fallback for an eye that gives light but shows no iris and no
 * lit disc (a hole, a void): its socket is the dark opening (Otsu), the orb sits at the opening's
 * largest inscribed disc, ORB_OF_SOCKET of its radius. Undefined when no opening reads.
 */
function orbFallback(eye: Rgba): { iris: Iris; socket: Uint8Array } | undefined {
  const socket = openingBits(eye, { look: "dark" });
  const disc = socket === undefined ? undefined : inscribedDisc(socket, eye.width, eye.height);
  if (socket === undefined || disc === undefined) return undefined;
  const r = Math.min(disc.r * ORB_OF_SOCKET, ORB_HEIGHT_SHARE * eye.height);
  return r < 2 ? undefined : { iris: { cx: disc.cx, cy: disc.cy, r }, socket };
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const area = (bits: Uint8Array): number => bits.reduce((s, v) => s + v, 0);

/** Reads one eye (see the header); undefined with the reason when unsure. */
function readEye(eye: Rgba, look: EyeLook, cues: EyeCues): { iris: Iris; socket: Uint8Array; cues: EyeCues } | string {
  const iris = measureIris(eye, { ...cues, look });
  if (iris === undefined) return `no ${look} iris found`;
  const socket = socketBits(eye, iris, { ...cues, look });
  if (socket === undefined) return `no ${look} socket around the iris`;
  return { iris, socket, cues: withColours(eye, iris, socket, { ...cues, look }) };
}

/** `cues` with the white's (white eyes) or the eyeball's (dark eyes) colour read inside `socket`, outside the iris. */
function withColours(eye: Rgba, iris: Iris, socket: Uint8Array, cues: EyeCues): EyeCues {
  const full: EyeCues = { ...cues };
  const sclera = cues.look === "white" ? (medianColour(eye, (i) => socket[i] === 1 && !inDisc(iris, eye.width, i, 1)) ?? scleraColour(eye, socket)) : undefined;
  const eyeball = cues.look === "dark" ? eyeballColour(eye, socket) : undefined;
  if (sclera !== undefined) full.sclera = sclera;
  if (eyeball !== undefined) full.eyeball = eyeball;
  return full;
}

/**
 * Socketed eyes for `rig` (see the header). `images` holds the layers' pixels by file, the eyes as
 * painted. Each iris layer is drawn right above its eye (z renumbered 1.. in order), anchored at the
 * iris centre, its `depth` the eye's; a glowing eye's `motion.pulse` moves to the iris with the glow.
 */
export function socketEyes(rig: Rig, images: Readonly<Record<string, Rgba>>, opts: SocketOptions = {}): SocketedRig {
  const files: Record<string, Rgba> = {};
  const eyes: EyeSocketing[] = [];
  const notes: string[] = [];
  const tint = hexRgb(rig.palette.eye);
  const extra = new Map<string, Layer>();
  const changed = new Map<string, Layer>();
  for (const layer of rig.layers) {
    const eye = images[layer.file];
    if (layer.kind !== "eye" || eye === undefined) continue;
    const glows = isEmissive(layer);
    // Unasked, an eye that gives light is read as a glow first (its light is its iris), then as white.
    const look = opts.looks?.[layer.name] ?? (glows ? "glow" : "white");
    const clean = opts.clean === undefined ? undefined : cropImage(opts.clean, layer.bbox);
    const marks = opts.marks === undefined ? undefined : cropImage(opts.marks, layer.bbox);
    const recipe = opts.eyes?.[layer.name] ?? {};
    const tintOff = recipe.tint === false ? { tint: false as const } : {};
    if (recipe.closedOnly === true) {
      // A closed-only eye: one piece (no gaze) with its closed art; its motion (blink, pulse) kept.
      if (recipe.closed === undefined) {
        notes.push(`${layer.name}: one piece (closed-only without closed art)`);
        continue;
      }
      files[closedFile(layer.name)] = recipe.closed;
      changed.set(layer.name, { ...layer, ...tintOff, closed: closedFile(layer.name) });
      notes.push(`${layer.name}: one piece with closed art (recipe)`);
      continue;
    }
    let read: ReturnType<typeof readEye>;
    let orbbed = false;
    if (recipe.socket !== undefined && recipe.iris !== undefined) read = { iris: recipe.iris, socket: recipe.socket, cues: withColours(eye, recipe.iris, recipe.socket, { look, tint }) };
    else {
      read = readEye(eye, look, { ...(clean === undefined ? {} : { clean }), ...(marks === undefined ? {} : { marks }), tint });
      if (typeof read === "string" && opts.looks?.[layer.name] === undefined && glows) read = readEye(eye, "white", { ...(clean === undefined ? {} : { clean }), tint });
      if (typeof read === "string" && opts.looks?.[layer.name] === undefined && glows) {
        // cast-face-pass: a lit eye with no iris and no lit disc (a hole, a void) gets a glow orb in its dark opening.
        const hole = orbFallback(eye);
        if (hole !== undefined) {
          read = { ...hole, cues: withColours(eye, hole.iris, hole.socket, { look: "dark", tint }) };
          orbbed = true;
        }
      }
      if (typeof read !== "string" && (recipe.socket !== undefined || recipe.iris !== undefined)) {
        const iris = recipe.iris ?? read.iris;
        const socket = recipe.socket ?? read.socket;
        read = { iris, socket, cues: withColours(eye, iris, socket, read.cues) };
      }
    }
    if (typeof read === "string") {
      notes.push(`${layer.name}: one piece (${read})`);
      continue;
    }
    const { iris, socket, cues } = read;
    const lookUsed = cues.look ?? look;
    const cleaned = recipe.clean ?? cleanEye(eye, iris, socket, { look: lookUsed, ...(cues.clean === undefined ? {} : { clean: cues.clean }), ...(cues.sclera === undefined ? {} : { sclera: cues.sclera }) });
    const below = compositeRig({ ...rig, layers: rig.layers.filter((l) => l.z < layer.z) }, images);
    const edited = recipe.closed !== undefined ? { image: recipe.closed, fromPlate: true } : opts.closed === undefined ? undefined : closedArt(eye, cropImage(opts.closed, layer.bbox), socket);
    const closed = edited?.fromPlate === true ? edited : closedArt(eye, cropImage(below, layer.bbox), socket);
    const closedFrom = recipe.closed !== undefined ? "recipe" : edited?.fromPlate === true ? "edit" : closed.fromPlate ? "plate" : "painted lids";
    const orb = recipe.orb ?? (orbbed ? {} : undefined);
    const art = recipe.irisArt ?? (orb === undefined ? irisImage(eye, iris, socket) : orbArt({ ...iris, r: orb.r ?? iris.r }, { ...orb, rgb: orb.rgb ?? lightColour(eye, socket) ?? tint }));
    const name = irisName(layer.name);
    const [bx, by] = layer.bbox;
    files[layer.file] = cleaned;
    files[socketFile(layer.name)] = bitsToImage(socket, eye.width, eye.height);
    files[closedFile(layer.name)] = featherClosed(eye, closed.image, socket);
    files[`${name}.png`] = art.image;
    const { motion, ...rest } = layer;
    const pulse = glows ? motion?.pulse : undefined;
    // Per-eye motion: the blink (its own phase) and the float stay on the eye; a glowing eye's pulse moves to the iris.
    const keep = motion === undefined ? undefined : pulse === undefined ? motion : motion.blink === undefined && motion.float === undefined ? undefined : { ...(motion.float === undefined ? {} : { float: motion.float }), ...(motion.blink === undefined ? {} : { blink: motion.blink }) };
    changed.set(layer.name, { ...rest, ...(keep === undefined ? {} : { motion: keep }), ...(glows ? { emissive: false } : {}), ...tintOff, socket: socketFile(layer.name), closed: closedFile(layer.name) });
    extra.set(layer.name, {
      name,
      z: layer.z,
      kind: "iris",
      file: `${name}.png`,
      bbox: [bx + art.box[0], by + art.box[1], art.box[2], art.box[3]],
      anchor: [bx + iris.cx, by + iris.cy],
      follow: layer.name,
      ...(layer.depth === undefined ? {} : { depth: layer.depth }),
      ...(pulse === undefined ? {} : { motion: { pulse } }),
      // The player lights an iris by default: an eye that gave no light gets an unlit iris.
      ...(glows ? {} : { emissive: false }),
      ...tintOff,
    });
    eyes.push({ name: layer.name, look: lookUsed, original: eye, clean: cleaned, socket, iris, cues, closedFrom, ...(recipe.clean === undefined ? {} : { ownClean: true as const }) });
    notes.push(`${layer.name}: socketed (${lookUsed}${cues.clean === undefined ? "" : ", edit"}${orb === undefined ? "" : ", glow orb"}${recipe.socket === undefined ? "" : ", recipe socket"}; iris r ${iris.r.toFixed(1)} at ${(bx + iris.cx).toFixed(1)},${(by + iris.cy).toFixed(1)}; socket ${area(socket)} px; closed ${closedFrom}${glows ? "; glow on the iris" : ""})`);
  }
  const ordered: Layer[] = [];
  for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
    ordered.push(changed.get(layer.name) ?? layer);
    const iris = extra.get(layer.name);
    if (iris !== undefined) ordered.push(iris);
  }
  const layers = extra.size === 0 && changed.size === 0 ? rig.layers : ordered.map((layer, i) => ({ ...layer, z: i + 1 }));
  return { rig: { ...rig, layers }, files, eyes, notes };
}

export interface VariantEye {
  /** The face's eye with the iris painted out (the patch's new pixels). */
  image: Rgba;
  /** The face's lid opening (an alpha mask at the layer's bbox). */
  socket: Rgba;
  narrowed: boolean;
  /** How far its iris sits from the base's, px, or "unsure" when the face hides it. */
  drift: number | "unsure";
  /** The socket was the base's (the face's own could not be read). */
  socketFromBase: boolean;
}

/**
 * One expression face of a socketed eye (see the header). `face` is the eye patch's image (the layer's
 * bbox). cast-face-pass: `track` "glow" finds the iris again by its light (a lit ring on a dark eyeball:
 * the Tallyman), whatever the eye's look.
 */
export function socketVariant(eye: EyeSocketing, face: Rgba, track?: EyeLook): VariantEye {
  const { iris, cues, look } = eye;
  let moved: Iris = iris;
  let drift: number | "unsure" = "unsure";
  if (look !== "glow" && track === "glow") {
    // The light's largest disc, sideways only (it sinks as a lid lowers), in the eye and the face alike,
    // as faceStability follows it; a move past IRIS_DRIFT_LIMIT is a lid cutting the light: unsure.
    const tint = cues.tint === undefined ? {} : { tint: cues.tint };
    const a = measureIris(eye.original, { look: "glow", ...tint });
    const b = measureIris(face, { look: "glow", ...tint });
    if (a !== undefined && b !== undefined && Math.abs(b.cx - a.cx) <= IRIS_DRIFT_LIMIT) {
      moved = { ...iris, cx: iris.cx + Math.round(b.cx - a.cx) };
      drift = Math.abs(b.cx - a.cx);
    }
  } else if (look === "glow") {
    const again = measureIris(face, { look, ...(cues.tint === undefined ? {} : { tint: cues.tint }) });
    if (again !== undefined) {
      moved = { ...again, r: iris.r };
      drift = Math.hypot(again.cx - iris.cx, again.cy - iris.cy);
    }
  } else {
    const found = trackIris(eye.original, iris, face);
    // As faceStability: a move counts only when it matches clearly better than none (else the lids hide the iris).
    const moves = found.error <= TRACK_UNSURE && found.still - found.error >= TRACK_GAIN * found.still;
    if (moves) {
      moved = { cx: found.cx, cy: found.cy, r: iris.r };
      drift = Math.hypot(found.cx - iris.cx, found.cy - iris.cy);
    }
    else if (found.error <= TRACK_UNSURE) drift = 0;
  }
  const dx = Math.round(moved.cx - iris.cx);
  const dy = Math.round(moved.cy - iris.cy);
  const w = face.width;
  const irisAt = (x: number, y: number): boolean => {
    const sx = x - dx;
    const sy = y - dy;
    if (sx < 0 || sy < 0 || sx >= w || sy >= face.height) return false;
    const a = (y * w + x) * 4;
    const b = (sy * w + sx) * 4;
    return Math.hypot((face.data[a] ?? 0) - (eye.original.data[b] ?? 0), (face.data[a + 1] ?? 0) - (eye.original.data[b + 1] ?? 0), (face.data[a + 2] ?? 0) - (eye.original.data[b + 2] ?? 0)) <= IRIS_MATCH;
  };
  const base: EyeCues = { ...cues };
  delete base.clean;
  delete base.marks;
  const found = socketBits(face, moved, { ...base, look, irisAt });
  // A face's lids close in or open a little: its opening stays within the base's grown by SOCKET_GROW of its height.
  const rows = new Set([...eye.socket.keys()].filter((i) => eye.socket[i] === 1).map((i) => Math.floor(i / w)));
  const reach = growBits(eye.socket, w, face.height, Math.max(1, Math.round(SOCKET_GROW * rows.size)));
  // Where the base was open and the face kept the eye's own pixels (or its moved iris), it is still open;
  // past that, only what reads as an opening within the reach (wider lids).
  const kept = eye.socket.map((v, i) => {
    if (v !== 1) return 0;
    const a = i * 4;
    const same = Math.hypot((face.data[a] ?? 0) - (eye.original.data[a] ?? 0), (face.data[a + 1] ?? 0) - (eye.original.data[a + 1] ?? 0), (face.data[a + 2] ?? 0) - (eye.original.data[a + 2] ?? 0)) <= SAME_DIST;
    return same || irisAt(i % w, Math.floor(i / w)) ? 1 : 0;
  });
  const grown = found === undefined ? kept : kept.map((v, i) => (v === 1 || (eye.socket[i] === 0 && (found[i] ?? 0) & (reach[i] ?? 0)) ? 1 : 0));
  const own = fillHoles(keepComponent(grown, w, face.height, (i) => inDisc(moved, w, i)), w, face.height);
  const socket = own ?? eye.socket;
  // A recipe's iris-free eye (a pixel pupil's black lens): the face's iris is painted out with the base's
  // own iris-free pixels where the base was open (the "glow" fill only dims a light, leaving a second pupil).
  const fill: EyeLook = eye.ownClean === true ? "white" : look;
  const image = cleanEye(face, moved, socket, { look: fill, base: { eye: eye.clean, socket: eye.socket }, ...(cues.sclera === undefined ? {} : { sclera: cues.sclera }) });
  return { image, socket: bitsToImage(socket, face.width, face.height), narrowed: area(socket) < NARROW_SHARE * area(eye.socket), drift, socketFromBase: own === undefined };
}

/**
 * The rig as it was before `socketEyes` (iris layers out, eyes without socket and closed art, an eye
 * whose iris glows lit again): the live forge re-reads its socketing from it on every expression GET.
 */
export function unsocketed(rig: Rig): Rig {
  const irises = rig.layers.filter((l) => l.kind === "iris");
  const layers = rig.layers
    .filter((l) => l.kind !== "iris")
    .map((l) => {
      if (l.kind !== "eye" || l.socket === undefined) return l;
      const iris = irises.find((i) => i.follow === l.name);
      const out: Layer = { ...l };
      delete out.socket;
      delete out.closed;
      delete out.emissive;
      return iris !== undefined && iris.emissive === false ? { ...out, emissive: false } : out;
    });
  return { ...rig, layers };
}
