// The Tallyman's six eyes (cast-face-pass, WP1; see faces/index.mjs). Low-poly: each eye is a dark
// olive eyeball between grey lids with a glowing yellow-green ring iris around a black pupil, and the
// pince-nez's bronze wire is painted into the lower inner corner of the middle pair. The socket is the
// dark eyeball (`eyeball`: darker than the plate's shut lids under it, ring and pupil filled) minus the wire's bronze pixels, so
// the wire stays in the eye art and the iris never covers it; the iris is the lit ring's disc (the
// palette's eye colour), cut whole and lit. Closed: the plate's lids (closedArt reads them as lid). Each
// eye keeps its own blink phase (socketEyes keeps motion.blink). The mouth stays render "drawn".

import { FLOOR_EDIT } from "./floor.mjs";

/** Bronze: warm (r > g > b) and saturated; the iris's yellow-green has g >= r, the lids are grey. */
export const isWire = (r, g, b) => r > g + 6 && g > b + 6 && r - b >= 45;

const lumaAt = (img, i) => 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
/** An eyeball pixel differs from the plate under it (grey shut lids) by more than this luma. */
export const PLATE_DIFF = 22;
/** The lit ring's soft outer edge (px past the measured disc) joins the eyeball. */
export const IRIS_RIM = 2.5;
/** The lit ring's dark outline, px past its light: part of the iris. */
export const RING_OUTLINE = 1.5;

/**
 * The dark eyeball of one eye: where the eye is darker than the plate under it by more than PLATE_DIFF
 * (the plate paints grey shut lids there; the lids around the eyeball match it), the component around
 * the iris, ring and pupil filled, row and column spans filled, its upper half mirrored down, minus the wire.
 */
function eyeball(forge, eye, below, iris) {
  const { width: w, height: h } = eye;
  const dark = new Uint8Array(w * h).map((_, i) => (eye.data[i * 4 + 3] >= 200 && (lumaAt(below, i) - lumaAt(eye, i) > PLATE_DIFF || forge.inDisc(iris, w, i, IRIS_RIM)) ? 1 : 0));
  // Spans filled: the eyeball is convex along rows and columns (its lower half is lighter, nearer the plate).
  const bits = forge.spanFill(forge.fillHoles(forge.keepComponent(dark, w, h, (i) => forge.inDisc(iris, w, i)), w, h), w, h);
  // The lower eyeball is shaded nearly like the plate's lower lid: the almond's upper half (read
  // cleanly) mirrored across the iris's row, kept where it is darker than the lids (the median luma
  // of the opaque pixels within 4 px of the eye's edge).
  const rim = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (eye.data[i * 4 + 3] >= 200 && (x < 4 || y < 4 || x >= w - 4 || y >= h - 4)) rim.push(lumaAt(eye, i));
  }
  const lid = [...rim].sort((p, q) => p - q)[rim.length >> 1] ?? 0;
  const mirrored = bits.map((v, i) => {
    if (v === 1) return 1;
    const x = i % w;
    const my = Math.round(2 * iris.cy - (i - x) / w - 1);
    return my >= 0 && my < h && bits[my * w + x] === 1 && eye.data[i * 4 + 3] >= 200 && lumaAt(eye, i) < lid ? 1 : 0;
  });
  const clean = mirrored.map((v, i) => (v === 1 && !isWire(eye.data[i * 4], eye.data[i * 4 + 1], eye.data[i * 4 + 2]) ? 1 : 0));
  // One piece: stray mirrored specks in the lower lid fall away.
  return forge.keepComponent(clean, w, h, (i) => forge.inDisc(iris, w, i));
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export const tallyman = {
  look: "dark",
  // The stability gate follows the lit ring (its light's largest disc), as the scout measured it.
  track: "glow",
  // The old joy and showman faces pass the numbers but leave pieces of their old rings around the irises (sheet): regenerated.
  fresh: ["joy", "showman"],
  // The six eyes stand in two columns of three; the band over their union reaches the brows above the
  // top pair (0.9 eye widths, the default) and the cheek just below the bottom pair.
  band: {},
  edits: { "iris-free": false, "eye-marks": false, closed: false, floor: FLOOR_EDIT },
  material:
    "The six eyes are glowing yellow-green ring irises with black pupils on dark eyeballs in a low-poly grey face: keep all six irises and pupils exactly as painted, keep the gold pince-nez on the nose exactly as it is, and shape only the flat low-poly brow and lid facets.",
  eyes: ({ forge, rig, images }) => {
    const tint = hexRgb(rig.palette.eye);
    const out = {};
    for (const layer of rig.layers.filter((l) => l.kind === "eye")) {
      const eye = images[layer.file];
      const lit = forge.measureIris(eye, { look: "glow", tint });
      if (lit === undefined) continue;
      // The lit ring's disc plus its dark outline (the faces' paint-out left the outline as a ring).
      const iris = { ...lit, r: lit.r + RING_OUTLINE };
      const below = forge.cropImage(forge.compositeRig({ ...rig, layers: rig.layers.filter((l) => l.z < layer.z) }, images), layer.bbox);
      const socket = eyeball(forge, eye, below, iris);
      if (socket !== undefined) out[layer.name] = { socket, iris };
    }
    return out;
  },
  why: "six dark eyeballs with lit ring irises: socket = the dark eyeball minus the pince-nez wire, iris = the lit ring cut whole; closed lids from the plate; per-eye blink phases kept",
};
