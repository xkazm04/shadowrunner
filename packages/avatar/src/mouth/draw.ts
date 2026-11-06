// What both renderers share to draw the mouth: where it goes this frame (the measured mouth in the
// head's frame, drawn right after the later of the head and the jaw), its colours (sampled once per
// rig from the rest art) and the paint itself (mouth/paint.ts). canvas2d paints straight onto its
// context; WebGL paints into a small offscreen canvas and draws it as a quad (gl/mouth.ts).
import type { Layer, LayerPose, Rig } from "@sr/rig";
import type { View } from "../render/frame.js";
import type { RigAssets } from "../render/types.js";
import { anchorOf, mouthGeometry, mouthLayers, type MouthAnchor, type Posed } from "./anchor.js";
import { defaultMouthSurface, sampleArt, type Mouth2D, type MouthColours, type MouthSurfaceFactory } from "./colours.js";
import { createPatchCache, paintMouth } from "./paint.js";
import type { MouthPose } from "./state.js";

export interface MouthPlace {
  anchor: MouthAnchor;
  /** The pose the mouth is drawn after (the later of head and jaw in draw order), and its layer. */
  host: Posed;
  /** The layer whose frame the mouth is in (the head, else the jaw): its light tints the mouth. */
  frame: Posed;
}

export interface MouthArt {
  /** Where the mouth goes this frame, or undefined (no usable `rig.mouth`, or no jaw drawn). */
  place(rig: Rig, layers: ReadonlyMap<string, Layer>, poses: readonly LayerPose[], view: View, browY: number): MouthPlace | undefined;
  /** The rig's mouth colours (cached per rig and assets), or undefined when the art cannot be read. */
  colours(rig: Rig, assets: RigAssets): MouthColours | undefined;
  /** Paints the mouth on `g` at `anchor` (its affine is set on `g`; drawn in rig px). */
  paint(g: Mouth2D, anchor: MouthAnchor, pose: MouthPose, colours: MouthColours): void;
}

export function createMouthArt(surface: MouthSurfaceFactory = defaultMouthSurface): MouthArt {
  const patches = createPatchCache(surface);
  let sampled: { rig: Rig; assets: RigAssets; colours: MouthColours | undefined } | undefined;
  return {
    place(rig, layers, poses, view, browY) {
      const geometry = mouthGeometry(rig.mouth);
      if (geometry === undefined) return undefined;
      const found = mouthLayers(layers, poses);
      if (found === undefined) return undefined;
      const { jaw, head } = found;
      const host = head !== undefined && head.index > jaw.index ? head : jaw;
      return { anchor: anchorOf(geometry, jaw, head, view, browY), host, frame: head ?? jaw };
    },
    colours(rig, assets) {
      if (sampled?.rig !== rig || sampled.assets !== assets) {
        const mouth = rig.mouth;
        sampled = { rig, assets, colours: mouth === undefined ? undefined : sampleArt(rig, assets, mouth, surface) };
      }
      return sampled.colours;
    },
    paint(g, anchor, pose, colours) {
      paintMouth(g, { anchor, params: pose.params, colours, alpha: pose.alpha, lips: pose.lips }, patches);
    },
  };
}
