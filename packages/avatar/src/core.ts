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
