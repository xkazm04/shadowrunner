// @sr/engine: Engine interface, ScriptedEngine, AnthropicEngine (spec voice-and-air), and the
// health and plane wire contract shared by api/ and apps/web.
export const PACKAGE = "@sr/engine";

export { ENGINE_STATES, PLANE_HEADER, PLANES, type EngineState, type Health, type Plane } from "./health.js";
export { parseHealth } from "./validate.js";
