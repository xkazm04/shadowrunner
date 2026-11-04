// The player's cutout (spec avatar-reach, found by the live e2e run): a rig's painted backdrop is an
// opaque square, so a transparent overlay, an embed on a page and a studio colour all showed it. The
// player hides it unless asked to keep it, as the stage does (air/AirPage.tsx STAGE_HIDDEN).
import type { Look } from "@sr/rig";

/** The layer name of a rig's painted backdrop (the forge and the cast name it so). */
export const BACKDROP_LAYER = "background";

/** The look without the backdrop layer, unless the backdrop is kept. */
export function cutoutLook(look: Look, backdrop = false): Look {
  if (backdrop || look.hidden.includes(BACKDROP_LAYER)) return look;
  return { ...look, hidden: [...look.hidden, BACKDROP_LAYER].sort() };
}
