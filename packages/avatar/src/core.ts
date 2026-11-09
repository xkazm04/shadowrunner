// @sr/avatar/core: everything but the React component, for bundles that must not carry React
// (the <sr-avatar> element, spec avatar-reach). `@sr/avatar` re-exports all of it.
export const PACKAGE = "@sr/avatar";

export * from "./driver/state.js";
export * from "./driver/step.js";
export * from "./driver/drive.js";
export * from "./driver/lookAt.js";
export * from "./audio/level.js";
export * from "./render/types.js";
export * from "./render/frame.js";
export * from "./render/recolour.js";
export * from "./render/assets.js";
export * from "./gl/renderer.js";
export * from "./canvas2d/renderer.js";
export * from "./react/loop.js";
export * from "./player/player.js";
// The drawn mouth (spark llm-avatar-lab, "the rig owns the mouth"): shapes, emotion bias, the
// per-frame mouth state, anchor and paint, for callers that drive or inspect it (the lab).
export * from "./mouth/shapes.js";
export * from "./mouth/emotion.js";
export * from "./mouth/state.js";
export * from "./mouth/anchor.js";
export * from "./mouth/colours.js";
export * from "./mouth/paint.js";
// Lip-sync (perfection-pass task 4): the viseme scheduler (moved from the Avatar Lab), the clip
// analyser and its per-frame drive. The analyser's internals (features, model, aligner) stay private.
export * from "./mouth/track.js";
export { analyseSpeech, POSTERIOR_SPAN, QUIET_DB, SILENCE_DB, TEXT_SHARE, type AnalyseOptions, type MouthTrack } from "./speech/analyse.js";
export * from "./speech/drive.js";
