// POST /api/forge/drafts - a casting batch: three draft portraits from an approved brief, each cut
// into a provisional rig (forge-creator L2). Thin: the logic lives in api/_lib/forge-cast.ts.
import { defaultCastDeps } from "../../_lib/forge-api.js";
import { handleCastPost } from "../../_lib/forge-cast.js";

export function POST(request: Request): Promise<Response> {
  return handleCastPost(request, defaultCastDeps());
}
