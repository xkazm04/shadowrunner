// The cast-face-pass characters' face recipes (WP1), merged into face-lib.mjs CAST_EYES. Each entry:
//   look      how socketEyes reads the eyes (white | glow | dark)
//   band      the brow+lid band's reach (stability.ts BandReach; `unit` = the px its shares multiply)
//   material  one more sentence for its expression edits (expressionPrompt's `material`)
//   edits     the eye edits eyes.mjs --request writes: { "iris-free"?, closed?, "eye-marks"? }: false skips
//             one, a string replaces its prompt
//   prepare   ({ forge, rig, images, portrait }) -> { rig, images }: the rig and layer images before socketing
//   eyes      ({ forge, rig, images, portrait, clean, marks, closed }) -> { <eye>: EyeRecipe } (faceEyes.ts)
//   track     the look the stability gate follows the irises by (default the eye's)
//   attempts  how many edits a face may take (default 3); `retry`: the sentence attempts past STRICTER add
//   fresh     families whose old face (a composite) is not tried
//   why       one line for the sheet and the provenance notes
import { FLOOR_EDIT } from "./floor.mjs";
import { redactor } from "./the-redactor.mjs";
import { tallyman } from "./the-tallyman.mjs";

export const CAST_FACES = {
  // Line art: a human eye with dim green whites around a glowing emerald iris (emissive). The iris-free
  // and mask edits read it as Saint Cardia's; the plate under the eye already paints the closed lids.
  // The iris-free edit repaints the whites bright cream (the art's are dim grey-green): its repaint
  // gives the opening exactly (the socket), the mask edit the iris, and the whites under the iris are the
  // edit's shading in the art's own colour (each channel scaled by the art's white over the edit's,
  // medians over the socket outside the iris).
  "lot-ninety": {
    look: "white",
    edits: { closed: false },
    eyes: ({ forge, rig, images, marks, clean }) => {
      const out = {};
      for (const layer of rig.layers.filter((l) => l.kind === "eye")) {
        const eye = images[layer.file];
        if (clean === undefined || marks === undefined) continue;
        const c = forge.cropImage(clean, layer.bbox);
        const socket = forge.openingBits(eye, { look: "white", clean: c });
        const iris = forge.measureIris(eye, { look: "white", marks: forge.cropImage(marks, layer.bbox) });
        if (socket === undefined || iris === undefined) continue;
        const w = eye.width;
        const white = (img) => forge.medianColour(img, (i) => socket[i] === 1 && !forge.inDisc(iris, w, i, 2));
        const [art, edit] = [white(eye), white(c)];
        if (art === undefined || edit === undefined) continue;
        const whites = { ...eye, data: eye.data.slice() };
        for (let i = 0; i < w * eye.height; i++) {
          if (socket[i] !== 1) continue;
          for (let k = 0; k < 3; k++) whites.data[i * 4 + k] = Math.round((c.data[i * 4 + k] * art[k]) / Math.max(1, edit[k]));
        }
        // The iris art is cut as painted, the lid's shadow across its top included (it reads as the lid's
        // shadow when the gaze drops); cutting the ink out left a flat disc (sheet 2026-11-06).
        out[layer.name] = { iris, socket, clean: whites };
      }
      return out;
    },
    why: "line-art human eye: dim green whites around a glowing emerald iris; socket = the iris-free edit's repaint, iris = the mask edit's, whites = the edit's shading in the art's own colour; closed lids from the plate",
  },
  // A porcelain puppet: grey irises with a red glowing pupil; the plate under the eyes is an empty hole,
  // so the blink comes from a closed-eyes edit (painted porcelain lids). The iris keeps its own grey and
  // red (tint false): the palette's eye red would tint the grey iris.
  understudy: {
    look: "white",
    // The faces' limit is the editor's no-op re-render floor (Director, 2026-11-06), not the iris-free edit's level.
    edits: { floor: FLOOR_EDIT },
    // A fourth attempt for a face whose three were refused: Codex re-rendered the cracked porcelain
    // across the whole face (outside-band 8.1-8.9 on joy, gloom), not just the brows.
    attempts: 4,
    // Its showman face opens the lids wide, yet its socket read from the edit's whites came up 20% short (2213 vs 2910 px).
    wide: ["showman"],
    retry: "Keep the porcelain texture, every crack line, the blush and the shading of the cheeks, nose, forehead and chin pixel for pixel; repaint nothing but the brows and the eyelids.",
    material: "The eyes are a porcelain puppet's painted glass eyes with grey irises and glowing red pupils: keep them exactly as painted, and keep the dummy's hinged jaw and slot lines untouched.",
    eyes: ({ rig }) => Object.fromEntries(rig.layers.filter((l) => l.kind === "eye").map((l) => [l.name, { tint: false }])),
    why: "porcelain puppet eyes: grey iris with a red glowing pupil (iris-free + mask edits, tint false); closed porcelain lids from a closed-eyes edit",
  },
  "the-tallyman": tallyman,
  "the-redactor": redactor,
};
