// POST /api/engine/reply - Vercel Node function, Web handler signature (voice-and-air req 2).
// Body: EngineRequest. Answers EngineReply or `{ error: { code, message } }`.
// - replay plane (default, or `x-sr-plane: replay`): ScriptedEngine over the recorded show, no
//   network call;
// - live plane: `checkAndCharge(ip, "engine", usd)` first, then one AnthropicEngine call.
// Chat is cut to the last 20 messages of at most 300 characters each, never rejected for length.
import {
  AnthropicEngine,
  decodeJson,
  EngineError,
  limitRequest,
  MAX_CHAT_MESSAGES,
  parseEngineRequest,
  ScriptedEngine,
  type EngineReply,
  type FetchLike as EngineFetch,
} from "@sr/engine";
import { COST_USD } from "../_lib/costs.js";
import { ApiError, errorResponse } from "../_lib/errors.js";
import { planeFromRequest, type Env } from "../_lib/plane.js";
import { checkAndCharge, clientIp, type Quota } from "../_lib/quota.js";
import { replayShow } from "../_lib/show.js";

/** Bodies above this are refused before parsing (a 20 x 300 chat plus a bible fits easily). */
export const MAX_BODY_BYTES = 256 * 1024;

export interface ReplyDeps {
  env: Env;
  fetch: EngineFetch;
  quota: Pick<Quota, "checkAndCharge">;
}

const NO_STORE = { "cache-control": "no-store" };

function defaultDeps(): ReplyDeps {
  return { env: process.env, fetch: (url, init) => fetch(url, init), quota: { checkAndCharge } };
}

async function readRequest(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) throw new ApiError("bad_input", "The request is too large.");
  const parsed = parseEngineRequest(decodeJson(text), MAX_CHAT_MESSAGES);
  if (parsed === undefined) throw new ApiError("bad_input", "The request is not a valid engine request.");
  return limitRequest(parsed);
}

/** The handler with its dependencies injected (tests pass a fake fetch and a memory quota). */
export async function handleReply(request: Request, deps: ReplyDeps): Promise<Response> {
  try {
    if (request.method !== "POST") throw new ApiError("bad_input", "Use POST.", 405);
    const req = await readRequest(request);
    let reply: EngineReply;
    if (planeFromRequest(request, deps.env) === "replay") {
      reply = await new ScriptedEngine(replayShow()).reply(req);
    } else {
      const apiKey = deps.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) throw new ApiError("upstream", "The engine is offline.");
      const charged = await deps.quota.checkAndCharge(clientIp(request), "engine", COST_USD.engineReply);
      if (!charged.ok) throw new ApiError("quota", "The engine has spoken enough for today. Come back tomorrow.");
      try {
        reply = await new AnthropicEngine({ apiKey, fetch: deps.fetch, env: deps.env }).reply(req);
      } catch (err) {
        if (err instanceof EngineError) throw new ApiError(err.code, "The engine did not answer. Try again.");
        throw err;
      }
    }
    return Response.json(reply, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

export function POST(request: Request): Promise<Response> {
  return handleReply(request, defaultDeps());
}
