// POST /api/forge/:jobId/faces - repaint one expression family of a live forge within its 24 h
// (forge-creator S2). Thin: the logic lives in api/_lib/forge-repaint.ts.
import { defaultForgeDeps } from "../../_lib/forge-api.js";
import { handleRepaintPost } from "../../_lib/forge-repaint.js";

export function POST(request: Request): Promise<Response> {
  return handleRepaintPost(request, defaultForgeDeps());
}
