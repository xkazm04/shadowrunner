// GET /api/health - Vercel Node function, Web handler signature.
// m0-spine task 1 stub: proves the api member compiles and answers JSON.
// m0-spine task 5 replaces the body with { plane, engine, version } from api/_lib/plane.ts.
export function GET(): Response {
  return Response.json({ ok: true });
}
