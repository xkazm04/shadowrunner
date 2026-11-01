// GET /api/forge/:jobId - advance the job at most one step and return its JobView
// (forge-pipeline requirement 7.1). Thin: the logic lives in api/_lib/forge-api.ts.
import { defaultForgeDeps, handleForgeGet } from "../_lib/forge-api.js";

export function GET(request: Request): Promise<Response> {
  return handleForgeGet(request, defaultForgeDeps());
}
