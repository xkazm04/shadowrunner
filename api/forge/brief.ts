// POST /api/forge/brief - a vague request -> a CharacterBrief (cast-forge requirement 4.1, 4.3).
// Thin: plane, quota, the brief call and the recorded briefs live in api/_lib/forge-brief.ts.
import { defaultBriefDeps, handleBriefPost } from "../_lib/forge-brief.js";

export function POST(request: Request): Promise<Response> {
  return handleBriefPost(request, defaultBriefDeps());
}
