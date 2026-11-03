// POST /api/forge/brief (cast-forge requirement 4.1, 4.3): a vague request -> a CharacterBrief.
// - replay plane (default, or `x-sr-plane: replay`): the recorded contest brief whose
//   one_line_request matches the request (case- and space-insensitive), else the first cast brief;
//   `plane: "replay"` so the creator labels it RECORDED. No key, no quota, no fetch.
// - live plane: `checkAndCharge(ip, "forge", COST_USD.brief)`, then one Messages API call through
//   the engine's client (`SR_BRIEF_MODEL`, default the engine's model) with the exact BRIEF_PROMPT.
//   The answer is checked by `parseBriefJson`; an invalid answer is asked once more, then `upstream`.
import { EngineError, engineModel, postMessages, type FetchLike } from "@sr/engine";
import {
  BRIEF_PROMPT,
  BRIEF_SCHEMA,
  briefFromRecorded,
  parseBriefJson,
  parseBriefRequest,
  recordedBriefFor,
  type BriefResponse,
  type CharacterBrief,
} from "@sr/forge";
import { COST_USD } from "./costs.js";
import { ApiError, errorResponse } from "./errors.js";
import { planeFromRequest, type Env } from "./plane.js";
import { checkAndCharge, clientIp, type Quota } from "./quota.js";

/** A brief answer is a 6..24-part JSON object with a 900-character prompt: 4000 tokens is ample. */
export const BRIEF_MAX_TOKENS = 4000;
/** Bodies above this are refused before parsing (the request itself is at most 2000 characters). */
export const MAX_BRIEF_BODY = 8 * 1024;
/** Asks per brief: the first, and one more after an invalid answer. */
export const BRIEF_ASKS = 2;

export interface BriefDeps {
  env: Env;
  fetch: FetchLike;
  quota: Pick<Quota, "checkAndCharge">;
  /** The recorded briefs, in slug order. */
  recorded(): readonly CharacterBrief[];
}

const NO_STORE = { "cache-control": "no-store" };

/** `SR_BRIEF_MODEL` when set (trimmed), otherwise the engine's model. */
export function briefModel(env: Env): string {
  return env.SR_BRIEF_MODEL?.trim() || engineModel(env);
}

/** The Messages API body for one brief request. Exposed so tests can pin its shape. */
export function buildBriefBody(request: string, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: BRIEF_MAX_TOKENS,
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: BRIEF_SCHEMA } },
    messages: [{ role: "user", content: BRIEF_PROMPT(request) }],
  };
}

async function liveBrief(request: string, apiKey: string, deps: BriefDeps): Promise<CharacterBrief> {
  const body = buildBriefBody(request, briefModel(deps.env));
  for (let ask = 0; ask < BRIEF_ASKS; ask += 1) {
    let text: string;
    try {
      const answer = await postMessages({ apiKey, fetch: deps.fetch }, body);
      if (answer.stopReason === "refusal") throw new ApiError("refused_content", "The brief writer will not make that. Change the description.");
      text = answer.text;
    } catch (err) {
      if (err instanceof EngineError) throw new ApiError("upstream", "The brief writer did not answer. Try again.");
      throw err;
    }
    const parsed = parseBriefJson(text);
    if (parsed.ok) return parsed.value;
    console.warn(`forge brief: invalid answer (${parsed.errors.syntax ? "not JSON" : `${parsed.errors.errors.length} rule(s)`}), ask ${ask + 1}`);
  }
  throw new ApiError("upstream", "The brief writer answered with something that is not a brief. Try again.");
}

/** The handler with its dependencies injected (tests pass a fake fetch and a memory quota). */
export async function handleBriefPost(req: Request, deps: BriefDeps): Promise<Response> {
  try {
    if (req.method !== "POST") throw new ApiError("bad_input", "Use POST.", 405);
    const text = await req.text().catch(() => "");
    if (text.length > MAX_BRIEF_BODY) throw new ApiError("bad_input", "The request is too large.");
    const parsed = parseBriefRequest(text);
    if (!parsed.ok) throw new ApiError("bad_input", parsed.errors.message);
    const { request } = parsed.value;
    let answer: BriefResponse;
    if (planeFromRequest(req, deps.env) === "replay") {
      const brief = recordedBriefFor(request, deps.recorded());
      if (brief === undefined) throw new ApiError("upstream", "No recorded briefs are available.");
      answer = { brief, plane: "replay" };
    } else {
      const apiKey = deps.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) throw new ApiError("upstream", "The brief writer is offline.");
      const charged = await deps.quota.checkAndCharge(clientIp(req), "forge", COST_USD.brief);
      if (!charged.ok) throw new ApiError("quota", "The cellar's budget for today is spent. Try the recorded gallery.");
      answer = { brief: await liveBrief(request, apiKey, deps), plane: "live" };
    }
    return Response.json(answer, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The committed contest briefs, adapted (`briefFromRecorded`), in slug order; bundled at build time. */
function bundledBriefs(): CharacterBrief[] {
  const files = import.meta.glob("../../assets/characters/cast/*/brief.json", { eager: true, import: "default" });
  const out: CharacterBrief[] = [];
  for (const path of Object.keys(files).sort()) {
    const brief = briefFromRecorded(files[path]);
    if (brief.ok) out.push(brief.value);
    else console.warn(`forge brief: skipped an invalid recorded brief (${path})`);
  }
  return out;
}

let recorded: CharacterBrief[] | undefined;

export function defaultBriefDeps(env: Env = process.env): BriefDeps {
  return {
    env,
    fetch: (url, init) => fetch(url, init),
    quota: { checkAndCharge },
    recorded: () => (recorded ??= bundledBriefs()),
  };
}
