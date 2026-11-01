// The server's plane (m0-spine requirement 4.1). `SR_PLANE=live` turns on paid calls; any other
// value, or none, is replay: recorded answers from assets/replay/**, no key needed, no network.
// Helpers take the environment as a parameter (default process.env) so tests never mutate it.
import { PLANE_HEADER, type EngineState, type Plane } from "@sr/engine";

export type Env = Readonly<Record<string, string | undefined>>;

/** The part of a request the plane reads (a Web `Request` fits). */
export interface PlaneRequest {
  readonly headers: { get(name: string): string | null };
}

export function plane(env: Env = process.env): Plane {
  return env.SR_PLANE?.trim().toLowerCase() === "live" ? "live" : "replay";
}

/**
 * The plane one request is served on. `x-sr-plane: replay` (any case, any padding, or among
 * comma-joined repeats) forces replay even on a live deploy; any other value is ignored, so the
 * header can never turn on paid calls (steering tech.md, "Plane override reaches the server").
 */
export function planeFromRequest(req: PlaneRequest, env: Env = process.env): Plane {
  const header = req.headers.get(PLANE_HEADER);
  const forced = header?.split(",").some((v) => v.trim().toLowerCase() === "replay") ?? false;
  return forced ? "replay" : plane(env);
}

/** Reads only whether the key is present; the key itself never leaves this function. */
export function engineState(current: Plane, env: Env = process.env): EngineState {
  if (current === "replay") return "scripted";
  return env.ANTHROPIC_API_KEY?.trim() ? "anthropic" : "offline";
}
