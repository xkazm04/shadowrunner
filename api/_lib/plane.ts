// The server's plane (m0-spine requirement 4.1). `SR_PLANE=live` turns on paid calls; any other
// value, or none, is replay: recorded answers from assets/replay/**, no key needed, no network.
// Helpers take the environment as a parameter (default process.env) so tests never mutate it.

export type Plane = "replay" | "live";

/**
 * Which engine answers chat. Replay always has ScriptedEngine. Live has AnthropicEngine, or is
 * offline when its key is missing, so the client can kill the bulb instead of failing per message.
 */
export type EngineState = "scripted" | "anthropic" | "offline";

export type Env = Readonly<Record<string, string | undefined>>;

export function plane(env: Env = process.env): Plane {
  return env.SR_PLANE?.trim().toLowerCase() === "live" ? "live" : "replay";
}

/** Reads only whether the key is present; the key itself never leaves this function. */
export function engineState(current: Plane, env: Env = process.env): EngineState {
  if (current === "replay") return "scripted";
  return env.ANTHROPIC_API_KEY?.trim() ? "anthropic" : "offline";
}
