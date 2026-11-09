// Film grain over the set (perfection-pass 5.3): a layer above the catacomb and the face, below
// the captions and the top row, never in the pointer's way and hidden from assistive tech.
// Cheap by construction: the noise is one small tile drawn once per page load on a 128 px canvas
// (no live SVG filter, no per-frame drawing), repeated as a background; the layer is moved by
// `transform` in steps (Grain.module.css), so each step is a composite of an already-painted
// layer, never a repaint. Its strength is the theme's fog (`--sr-haunt-fog`): zero in the
// baseline theme, and the stage's `data-haunt="off"` removes it. Under reduced motion it stands still.
import { useEffect, useState } from "react";
import styles from "./Grain.module.css";

/** The noise tile's side in pixels. */
export const GRAIN_TILE = 128;

/** The tile, once drawn (null: this browser cannot draw it, so the stage has no grain). */
let drawn: string | null | undefined;

/** Black and white specks of random strength, as a PNG data URL; undefined without a 2D canvas. */
export function grainTile(): string | undefined {
  if (drawn !== undefined) return drawn ?? undefined;
  const canvas = document.createElement("canvas");
  canvas.width = GRAIN_TILE;
  canvas.height = GRAIN_TILE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    drawn = null;
    return undefined;
  }
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = Math.floor(Math.random() * 256);
  }
  ctx.putImageData(image, 0, 0);
  drawn = canvas.toDataURL("image/png");
  return drawn;
}

export function Grain() {
  const [tile, setTile] = useState<string | undefined>(undefined);
  useEffect(() => setTile(grainTile()), []);
  return <div className={styles.grain} aria-hidden="true" data-grain="" style={tile === undefined ? undefined : { backgroundImage: `url(${tile})` }} />;
}
