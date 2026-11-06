// L1, the procedural mouth: Kokoro's viseme spans grouped into eight mouth shapes with
// coarticulation (mouth/track.ts) and handed to the player as a shape mix (setMouthShapes):
// @sr/avatar draws the mouth itself, on the rig's measured mouth, in the head's frame, with the
// character's emotion, in colours taken from its own art, and opens the jaw to match. The avatar
// canvas carries it, so the recorded composite does too. The audio is not attached to the player.
import type { LipDriverFactory } from "../types.js";
import { createMouthDriver } from "./mouth/driver.js";

export const createL1: LipDriverFactory = (ctx) => createMouthDriver("L1", ctx);
