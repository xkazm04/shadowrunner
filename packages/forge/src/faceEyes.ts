// Socketed eyes for a rig (face-control, WP-B): `socketEyes` turns each eye layer of an assembled
// rig into an iris-free eye with its socket mask and closed-lid art plus an iris layer (kind "iris",
// following the eye, emissive when the eye gave light: the glow moves to the iris), from the eye's
// own pixels (eyes.ts, eyeArt.ts) and, for white eyes, the iris-free edit of the portrait. An eye it
// is unsure of stays one painted piece. `socketVariant` does the same for one expression face of an
// eye: its iris found again, its own socket, `narrowed` when the lids close in, the iris painted out.
// The cast (scripts/cast/eyes.mjs, expressions.mjs) and the live forge share both. Pure.
import { isEmissive, type Layer, type Rig } from "@sr/rig";
import { cleanEye, closedArt, featherClosed, irisImage } from "./eyeArt.js";
import { fillHoles, growBits, keepComponent } from "./eyeBits.js";
import { bitsToImage, eyeballColour, inDisc, measureIris, medianColour, scleraColour, socketBits, type EyeCues, type EyeLook, type Iris } from "./eyes.js";
import { compositeRig } from "./composite.js";
import { TRACK_GAIN, TRACK_UNSURE, cropImage, trackIris } from "./stability.js";
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
  /** Where the closed-lid art came from: the closed-eyes edit, the plate under the eye, or the lid drawn down. */
  closedFrom: "edit" | "plate" | "painted lids";
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
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const area = (bits: Uint8Array): number => bits.reduce((s, v) => s + v, 0);

/** Reads one eye (see the header); undefined with the reason when unsure. */
function readEye(eye: Rgba, look: EyeLook, cues: EyeCues): { iris: Iris; socket: Uint8Array; cues: EyeCues } | string {
  const iris = measureIris(eye, { ...cues, look });
  if (iris === undefined) return `no ${look} iris found`;
  const socket = socketBits(eye, iris, { ...cues, look });
  if (socket === undefined) return `no ${look} socket around the iris`;
  const full: EyeCues = { ...cues, look };
  const sclera = look === "white" ? (medianColour(eye, (i) => socket[i] === 1 && !inDisc(iris, eye.width, i, 1)) ?? scleraColour(eye, socket)) : undefined;
  const eyeball = look === "dark" ? eyeballColour(eye, socket) : undefined;
  if (sclera !== undefined) full.sclera = sclera;
  if (eyeball !== undefined) full.eyeball = eyeball;
  return { iris, socket, cues: full };
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
    let read = readEye(eye, look, { ...(clean === undefined ? {} : { clean }), ...(marks === undefined ? {} : { marks }), tint });
    if (typeof read === "string" && opts.looks?.[layer.name] === undefined && glows) read = readEye(eye, "white", { ...(clean === undefined ? {} : { clean }), tint });
    if (typeof read === "string") {
      notes.push(`${layer.name}: one piece (${read})`);
      continue;
    }
    const { iris, socket, cues } = read;
    const lookUsed = cues.look ?? look;
    const cleaned = cleanEye(eye, iris, socket, { look: lookUsed, ...(cues.clean === undefined ? {} : { clean: cues.clean }), ...(cues.sclera === undefined ? {} : { sclera: cues.sclera }) });
    const below = compositeRig({ ...rig, layers: rig.layers.filter((l) => l.z < layer.z) }, images);
    const edited = opts.closed === undefined ? undefined : closedArt(eye, cropImage(opts.closed, layer.bbox), socket);
    const closed = edited?.fromPlate === true ? edited : closedArt(eye, cropImage(below, layer.bbox), socket);
    const closedFrom = edited?.fromPlate === true ? "edit" : closed.fromPlate ? "plate" : "painted lids";
    const art = irisImage(eye, iris, socket);
    const name = irisName(layer.name);
    const [bx, by] = layer.bbox;
    files[layer.file] = cleaned;
    files[socketFile(layer.name)] = bitsToImage(socket, eye.width, eye.height);
    files[closedFile(layer.name)] = featherClosed(eye, closed.image, socket);
    files[`${name}.png`] = art.image;
    const { motion, ...rest } = layer;
    const pulse = glows ? motion?.pulse : undefined;
    const keep = motion === undefined ? undefined : pulse === undefined ? motion : motion.blink === undefined && motion.float === undefined ? undefined : { ...(motion.float === undefined ? {} : { float: motion.float }), ...(motion.blink === undefined ? {} : { blink: motion.blink }) };
    changed.set(layer.name, { ...rest, ...(keep === undefined ? {} : { motion: keep }), ...(glows ? { emissive: false } : {}), socket: socketFile(layer.name), closed: closedFile(layer.name) });
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
    });
    eyes.push({ name: layer.name, look: lookUsed, original: eye, clean: cleaned, socket, iris, cues, closedFrom });
    notes.push(`${layer.name}: socketed (${lookUsed}${cues.clean === undefined ? "" : ", edit"}; iris r ${iris.r.toFixed(1)} at ${(bx + iris.cx).toFixed(1)},${(by + iris.cy).toFixed(1)}; socket ${area(socket)} px; closed ${closedFrom}${glows ? "; glow on the iris" : ""})`);
  }
  const ordered: Layer[] = [];
  for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
    ordered.push(changed.get(layer.name) ?? layer);
    const iris = extra.get(layer.name);
    if (iris !== undefined) ordered.push(iris);
  }
  const layers = extra.size === 0 ? rig.layers : ordered.map((layer, i) => ({ ...layer, z: i + 1 }));
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

/** One expression face of a socketed eye (see the header). `face` is the eye patch's image (the layer's bbox). */
export function socketVariant(eye: EyeSocketing, face: Rgba): VariantEye {
  const { iris, cues, look } = eye;
  let moved: Iris = iris;
  let drift: number | "unsure" = "unsure";
  if (look === "glow") {
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
  const image = cleanEye(face, moved, socket, { look, base: { eye: eye.clean, socket: eye.socket }, ...(cues.sclera === undefined ? {} : { sclera: cues.sclera }) });
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
