// The health and plane wire contract (m0-spine requirement 4). One owner: api/ answers with it,
// apps/web reads it. Bodies from the network are checked by parseHealth in ./validate.ts.

/** `replay` serves recorded answers from assets/replay/** with no key; `live` makes paid calls. */
export const PLANES = ["replay", "live"] as const;
export type Plane = (typeof PLANES)[number];

/**
 * Which engine answers chat. Replay always has ScriptedEngine. Live has AnthropicEngine, or is
 * offline when its key is missing, so the client can kill the bulb instead of failing per message.
 */
export const ENGINE_STATES = ["scripted", "anthropic", "offline"] as const;
export type EngineState = (typeof ENGINE_STATES)[number];

/** Body of GET /api/health. */
export interface Health {
  plane: Plane;
  engine: EngineState;
  version: string;
}

/**
 * Request header the client sends on every /api/* request while `?plane=replay` is active
 * (steering tech.md, "Plane override reaches the server"). Its only meaningful value is
 * `replay`: it can force replay on a live deploy, never live.
 */
export const PLANE_HEADER = "x-sr-plane";
