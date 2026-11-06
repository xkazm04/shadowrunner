// The eight mouth shapes WP3's lip arms use (the set, its params and mixes live in @sr/avatar, which
// draws the mouth: "the rig owns the mouth"), and the Oculus-15 viseme -> shape grouping, which
// stays here (the product has no visemes). Pure data, no DOM, so the Node mouth generator
// (src/mouths) reads the same list.
import type { MouthShape } from "@sr/avatar/core";
import type { Viseme } from "../../../contract.js";

export { blendParams, dominant, MOUTH_SHAPES, restWeights, SHAPE_PARAMS, type MouthParams, type MouthShape, type ShapeWeights } from "@sr/avatar/core";

/** Oculus 15 -> mouth shape (sil is rest; PBM close the lips; FV bite; L/TH/D/N show the tongue). */
export const VISEME_SHAPE: Readonly<Record<Viseme, MouthShape>> = {
  sil: "rest",
  PP: "closed",
  FF: "teeth",
  TH: "tongue",
  DD: "tongue",
  kk: "openMid",
  CH: "narrow",
  SS: "narrow",
  nn: "tongue",
  RR: "round",
  aa: "openWide",
  E: "openMid",
  ih: "narrow",
  oh: "round",
  ou: "round",
};
