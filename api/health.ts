// GET /api/health - Vercel Node function, Web handler signature.
// Answers { plane, engine, version } (m0-spine requirement 4.1). Works with no keys set; it
// reports whether the engine key is present, never its value. The body shape is `Health` from
// @sr/engine, the one owner of the wire contract.
import type { Health } from "@sr/engine";
import { engineState, plane, planeFromRequest, type Env, type PlaneRequest } from "./_lib/plane.js";

/** Short commit on Vercel (a system variable), `dev` everywhere else. */
export function version(env: Env = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : "dev";
}

/** With a request, `x-sr-plane: replay` is honoured, so health names the plane that client gets. */
export function health(env: Env = process.env, request?: PlaneRequest): Health {
  const current = request ? planeFromRequest(request, env) : plane(env);
  return { plane: current, engine: engineState(current, env), version: version(env) };
}

export function GET(request?: Request): Response {
  return Response.json(health(process.env, request), { headers: { "cache-control": "no-store" } });
}
