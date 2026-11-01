// Who is on air on the set: Malakor, or the user's own character once it is on air (landing
// requirement 3.5; the on-air flow is spec voice-and-air).
import type { RigAssets } from "@sr/avatar";
import type { Look, Rig } from "@sr/rig";

/** A character on the set: its rig, its look, and the images keyed by `Layer.file`. */
export interface OnAirCharacter {
  name: string;
  rig: Rig;
  look: Look;
  assets: RigAssets;
}

/** Who is on the set when the user has put nobody on air. */
export const RESIDENT = "Arch-Lich Malakor";
