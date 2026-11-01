// GET /api/health - Vercel Node function, Web handler signature.
// Answers { plane, engine, version } (m0-spine requirement 4.1). Works with no keys set; it
// reports whether the engine key is present, never its value.
import { engineState, plane, type EngineState, type Env, type Plane } from "./_lib/plane.js";

/** Wire shape. apps/web/src/app/plane.ts mirrors it (the app may not import api/). */
export interface Health {
  plane: Plane;
  engine: EngineState;
  version: string;
}

/** Short commit on Vercel (a system variable), `dev` everywhere else. */
export function version(env: Env = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : "dev";
}

export function health(env: Env = process.env): Health {
  const current = plane(env);
  return { plane: current, engine: engineState(current, env), version: version(env) };
}

export function GET(): Response {
  return Response.json(health(), { headers: { "cache-control": "no-store" } });
}
