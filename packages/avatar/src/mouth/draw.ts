// What both renderers share to draw the mouth: where it goes this frame (the measured mouth in the
// head's frame, drawn right after the later of the head and the jaw), its colours (sampled once per
// rig from the rest art) and the paint itself (mouth/paint.ts). canvas2d paints straight onto its
// context; WebGL paints into a small offscreen canvas and draws it as a quad (gl/mouth.ts).
import type { Layer, LayerPose, Look, Rig } from "@sr/rig";
import type { View } from "../render/frame.js";
import type { RigAssets } from "../render/types.js";
import { anchorOf, drawnMouthGeometry, mouthLayers, MOUTH_BOX, type MouthAnchor, type Posed } from "./anchor.js";
import { defaultMouthSurface, sampleArt, type Mouth2D, type MouthColours, type MouthSurface, type MouthSurfaceFactory } from "./colours.js";
import { createPatchCache, paintMouth, setAffine } from "./paint.js";
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
  /**
   * The rig's mouth colours (cached per rig, assets and look), or undefined when the art cannot be
   * read. With `look` the skin is sampled as the look recolours the art, so the cover matches it.
   */
  colours(rig: Rig, assets: RigAssets, look?: Pick<Look, "palette" | "regions">): MouthColours | undefined;
  /**
   * Paints the mouth on `g` at `anchor` (its affine is set on `g`; drawn in rig px). On pixel art
   * (`geometry.cell`) it paints on the art's grid: a crop at 1/cell resolution drawn up unsmoothed.
   */
  paint(g: Mouth2D, anchor: MouthAnchor, pose: MouthPose, colours: MouthColours): void;
  /** As `paint`, always smooth: the caller (the GL quad) owns the resolution. */
  paintFlat(g: Mouth2D, anchor: MouthAnchor, pose: MouthPose, colours: MouthColours): void;
}

/** The crop the pixel-art mouth paints into, snapped outward to whole cells of the canvas grid. */
export function cellCrop(cx: number, lineY: number, width: number, cell: number): { x: number; y: number; w: number; h: number; cols: number; rows: number } {
  const x0 = Math.floor((cx - width * MOUTH_BOX.left) / cell) * cell;
  const y0 = Math.floor((lineY - width * MOUTH_BOX.up) / cell) * cell;
  const x1 = Math.ceil((cx - width * MOUTH_BOX.left + width * MOUTH_BOX.width) / cell) * cell;
  const y1 = Math.ceil((lineY - width * MOUTH_BOX.up + width * MOUTH_BOX.height) / cell) * cell;
  const cols = Math.max(1, Math.round((x1 - x0) / cell));
  const rows = Math.max(1, Math.round((y1 - y0) / cell));
  return { x: x0, y: y0, w: cols * cell, h: rows * cell, cols, rows };
}

export function createMouthArt(surface: MouthSurfaceFactory = defaultMouthSurface): MouthArt {
  const patches = createPatchCache(surface);
  let sampled: { rig: Rig; assets: RigAssets; look: unknown; colours: MouthColours | undefined } | undefined;
  let crop: MouthSurface | null | undefined;
  const flat = (g: Mouth2D, anchor: MouthAnchor, pose: MouthPose, colours: MouthColours): void => {
    paintMouth(g, { anchor, params: pose.params, colours, alpha: pose.alpha, lips: pose.lips }, patches);
  };
  return {
    place(rig, layers, poses, view, browY) {
      const geometry = drawnMouthGeometry(rig.mouth);
      if (geometry === undefined) return undefined;
      const found = mouthLayers(layers, poses);
      if (found === undefined) return undefined;
      const { jaw, head } = found;
      const host = head !== undefined && head.index > jaw.index ? head : jaw;
      return { anchor: anchorOf(geometry, jaw, head, view, browY), host, frame: head ?? jaw };
    },
    colours(rig, assets, look) {
      if (sampled?.rig !== rig || sampled.assets !== assets || sampled.look !== look) {
        const mouth = rig.mouth;
        sampled = { rig, assets, look, colours: mouth === undefined ? undefined : sampleArt(rig, assets, mouth, surface, look) };
      }
      return sampled.colours;
    },
    paint(g, anchor, pose, colours) {
      const { cx, lineY, width, cell } = anchor.geometry;
      if (cell === undefined) return flat(g, anchor, pose, colours);
      const area = cellCrop(cx, lineY, width, cell);
      if (crop === undefined || crop === null || crop.canvas.width !== area.cols || crop.canvas.height !== area.rows) crop = surface(area.cols, area.rows);
      if (crop === null) return flat(g, anchor, pose, colours);
      const c = crop.g;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, area.cols, area.rows);
      // The crop is one art pixel per px: rig px -> crop px is 1/cell about the crop's corner.
      const local: MouthAnchor = { ...anchor, affine: [1 / cell, 0, 0, 1 / cell, -area.x / cell, -area.y / cell] };
      flat(c, local, pose, colours);
      g.save();
      setAffine(g, anchor.affine);
      g.imageSmoothingEnabled = false;
      g.drawImage(crop.canvas, area.x, area.y, area.w, area.h);
      g.restore();
    },
    paintFlat: flat,
  };
}
