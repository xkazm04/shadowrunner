// S1, the scene arm that applies scene events: light cues as eased backlight changes, candles
// (painted flames), an on-screen card, the caption of each spoken line in the current caption
// style, and polls. Live it is DOM + CSS (s1/view.ts, s1.module.css); for the recording the same
// frame is painted into the composite (s1/paint.ts). The model, painters and wiring are in s1/.
import type { SceneDriverFactory } from "../types.js";
import { createS1Driver } from "./s1/driver.js";
import { readPalette } from "./s1/palette.js";
import { createDomView } from "./s1/view.js";

export const createS1: SceneDriverFactory = (ctx) => {
  const style = getComputedStyle(ctx.stage);
  const palette = readPalette((role) => style.getPropertyValue(`--sr-${role}`));
  return createS1Driver(ctx, palette, createDomView(ctx.stage));
};
