// POST /api/forge - create a forge job and run its first step (forge-pipeline requirement 7.1).
// Thin: validation, plane, quota and steps live in api/_lib/forge-api.ts and @sr/forge.
import { defaultForgeDeps, handleForgePost } from "../_lib/forge-api.js";

export function POST(request: Request): Promise<Response> {
  return handleForgePost(request, defaultForgeDeps());
}
