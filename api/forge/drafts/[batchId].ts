// GET /api/forge/drafts/:batchId - advance a casting batch at most one step and return its
// CastView (forge-creator L2). Thin: the logic lives in api/_lib/forge-cast.ts.
import { defaultCastDeps } from "../../_lib/forge-api.js";
import { handleCastGet } from "../../_lib/forge-cast.js";

export function GET(request: Request): Promise<Response> {
  return handleCastGet(request, defaultCastDeps());
}
