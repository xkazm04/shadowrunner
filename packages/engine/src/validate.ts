// The only place @sr/engine checks external data (tech.md). Parsers take an already-decoded
// value, check its shape, and return undefined when it does not match.
import { ENGINE_STATES, PLANES, type EngineState, type Health, type Plane } from "./health.js";

const PLANE_NAMES: readonly string[] = PLANES;
const ENGINE_NAMES: readonly string[] = ENGINE_STATES;

function isPlane(value: unknown): value is Plane {
  return typeof value === "string" && PLANE_NAMES.includes(value);
}

function isEngineState(value: unknown): value is EngineState {
  return typeof value === "string" && ENGINE_NAMES.includes(value);
}

/** Validates a GET /api/health body from the network; extra fields are dropped. */
export function parseHealth(value: unknown): Health | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body: Partial<Record<keyof Health, unknown>> = value;
  const { plane, engine, version } = body;
  if (!isPlane(plane) || !isEngineState(engine) || typeof version !== "string") return undefined;
  return { plane, engine, version };
}
