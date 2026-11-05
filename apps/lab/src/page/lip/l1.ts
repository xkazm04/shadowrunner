// L1, the procedural mouth: Kokoro's viseme spans grouped into eight mouth shapes with
// coarticulation (mouth/track.ts), the jaw opened per shape through setLevel, and the shape drawn
// over the mouth in the recorded composite, in the head's frame, in colours taken from the
// character's own art (mouth/paint.ts). The audio is not attached to the player.
import type { LipDriverFactory } from "../types.js";
import { createMouthDriver } from "./mouth/driver.js";
import { createPatchCache, paintMouth } from "./mouth/paint.js";

export const createL1: LipDriverFactory = (ctx) => {
  const patches = createPatchCache();
  return createMouthDriver("L1", ctx, (g, f) => paintMouth(g, { anchor: f.anchor, params: f.params, colours: f.colours, alpha: f.alpha }, patches));
};
