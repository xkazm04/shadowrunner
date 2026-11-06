// The Redactor's eyes (cast-face-pass, WP1; see faces/index.mjs). Pixel art (cell 7.1 px): round black
// lenses (~65 px inside the rims) with a lit yellow 2-cell pupil (14 x 12 px) in the middle; the cut
// left an eye layer the pupil's size, so the socket would be the pupil itself. `prepare` grows each eye
// layer to its lens interior (`widenEye`): the dark component around the pupil in the art up to the eye,
// pupil filled. The socket is that lens; the iris is the pupil cut whole (the recorded eye image, hard
// pixels, lit); the iris-free eye is the lens with the pupil painted in the lens's black; the closed art
// is the lens unlit with a dim one-cell dash where the pupil's lower cell was. The gaze and the mouth
// warp snap to Rig.mouth.cell at runtime. The band's unit is the lens width (bandUnit).
import { FLOOR_EDIT } from "./floor.mjs";

/** The lens interior is darker than this luma (the rims and the face are light grey, the lens ~4). */
export const LENS_LUMA = 48;
/** How far (px) from the pupil the lens search reaches. */
export const LENS_REACH = 60;
/** The closed dash: the pupil's yellow at this brightness, one cell (Rig.mouth.cell) tall at its bottom. */
export const DASH_GAIN = 0.55;

const lumaAt = (img, i) => 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
/** Per eye: the recorded pupil image and its place in the lens (eye-local), set by `prepare`. */
const pupils = new Map();

export const redactor = {
  look: "glow",
  // Old faces that pass the numbers but not the look: anger lost the pixel grid (scout sheet), gloom and
  // smug leave their old pupil dash and yellow smile in the lens (sheet 2026-11-06): regenerated.
  fresh: ["anger", "gloom", "smug"],
  edits: { "iris-free": false, "eye-marks": false, closed: false, floor: FLOOR_EDIT },
  material:
    "This is pixel art on a hard 7-pixel grid: keep every pixel square, the grid aligned and the flat grey dither exactly; change only the pixel-art brow blocks above the round black glasses and keep both glasses, their black lenses and the small yellow square pupils exactly as they are, the same size and place.",
  prepare: ({ forge, rig, images }) => {
    let out = { rig, images };
    for (const layer of rig.layers.filter((l) => l.kind === "eye")) {
      const [ex, ey, ew, eh] = layer.bbox;
      const cx = ex + ew / 2;
      const cy = ey + eh / 2;
      const box = [Math.floor(cx - LENS_REACH), Math.floor(cy - LENS_REACH), 2 * LENS_REACH, 2 * LENS_REACH];
      const art = forge.cropImage(forge.compositeRig({ ...out.rig, layers: out.rig.layers.filter((l) => l.z <= layer.z) }, out.images), box);
      const n = box[2] * box[3];
      const inPupil = (i) => {
        const x = box[0] + (i % box[2]);
        const y = box[1] + Math.floor(i / box[2]);
        return x >= ex && x < ex + ew && y >= ey && y < ey + eh;
      };
      const dark = new Uint8Array(n).map((_, i) => (lumaAt(art, i) < LENS_LUMA || inPupil(i) ? 1 : 0));
      const lens = forge.fillHoles(forge.keepComponent(dark, box[2], box[3], inPupil), box[2], box[3]);
      let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
      lens.forEach((v, i) => {
        if (v !== 1) return;
        const x = i % box[2];
        const y = Math.floor(i / box[2]);
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      });
      const bbox = [box[0] + x0, box[1] + y0, x1 - x0 + 1, y1 - y0 + 1];
      const mask = new Uint8Array(bbox[2] * bbox[3]).map((_, i) => lens[(y0 + Math.floor(i / bbox[2])) * box[2] + x0 + (i % bbox[2])]);
      pupils.set(layer.name, { image: out.images[layer.file], box: [ex - bbox[0], ey - bbox[1], ew, eh] });
      out = forge.widenEye(out.rig, out.images, layer.name, bbox, mask);
    }
    return out;
  },
  eyes: ({ forge, rig, images }) => {
    const out = {};
    const cell = rig.mouth?.cell ?? 7;
    for (const layer of rig.layers.filter((l) => l.kind === "eye")) {
      const pupil = pupils.get(layer.name);
      const eye = images[layer.file];
      if (pupil === undefined || eye === undefined) continue;
      const { width: w, height: h } = eye;
      const socket = new Uint8Array(w * h).map((_, i) => (eye.data[i * 4 + 3] >= 128 ? 1 : 0));
      const [px, py, pw, ph] = pupil.box;
      const inPupil = (x, y) => x >= px && x < px + pw && y >= py && y < py + ph;
      const black = forge.medianColour(eye, (i) => socket[i] === 1 && !inPupil(i % w, Math.floor(i / w)) && lumaAt(eye, i) < LENS_LUMA) ?? [4, 4, 4];
      const lit = forge.medianColour(pupil.image, (i) => lumaAt(pupil.image, i) > 150) ?? [240, 230, 10];
      const clean = { ...eye, data: eye.data.slice() };
      const closed = { ...eye, data: eye.data.slice() };
      const dashTop = py + ph - Math.round(cell);
      // The pupil and its 1 px soft edge.
      for (let y = Math.max(0, py - 1); y < Math.min(h, py + ph + 1); y++) {
        for (let x = Math.max(0, px - 1); x < Math.min(w, px + pw + 1); x++) {
          const o = (y * w + x) * 4;
          clean.data.set(black, o);
          closed.data.set(y >= dashTop && y < py + ph && x >= px + 1 && x < px + pw - 1 ? lit.map((v) => Math.round(v * DASH_GAIN)) : black, o);
        }
      }
      out[layer.name] = { socket, iris: { cx: px + pw / 2, cy: py + ph / 2, r: Math.max(pw, ph) / 2 }, irisArt: pupil, clean, closed };
    }
    return out;
  },
  why: "pixel pupils in round black lenses: eye layer widened to the lens interior (socket), the 2-cell pupil cut whole as the lit iris, closed = the lens unlit with a dim one-cell dash",
};
