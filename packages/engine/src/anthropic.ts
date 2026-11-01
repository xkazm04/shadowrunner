// AnthropicEngine (voice-and-air requirement 1.3): one Messages API call per beat with a
// structured-output schema. `fetch` is injected, so tests run against a fake and never reach the
// network. The key goes only into the request header; no error message ever carries it.
import { personaPrompt, turnPrompt } from "./persona.js";
import { EngineError, parseReply, REPLY_SCHEMA } from "./schema.js";
import type { Engine, EngineReply, EngineRequest } from "./types.js";
import { parseMessagesResponse } from "./validate.js";

export const DEFAULT_ENGINE_MODEL = "claude-haiku-5-5";
export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";
/** design.md: `max_tokens` 300. */
export const ENGINE_MAX_TOKENS = 300;

/** The subset of the Fetch API the engine uses (a global `fetch` fits). */
export interface FetchInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type EngineEnv = Readonly<Record<string, string | undefined>>;

/** `SR_ENGINE_MODEL` when set (trimmed), otherwise `claude-haiku-5-5`. */
export function engineModel(env: EngineEnv): string {
  return env.SR_ENGINE_MODEL?.trim() || DEFAULT_ENGINE_MODEL;
}

/** The Messages API body for one request. Exposed so tests can pin its shape. */
export function buildMessagesBody(req: EngineRequest, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: ENGINE_MAX_TOKENS,
    // A one-line chat reply needs no reasoning; thinking off keeps all 300 tokens for the answer.
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_SCHEMA } },
    system: personaPrompt(req.persona),
    messages: [{ role: "user", content: turnPrompt(req) }],
  };
}

export interface AnthropicEngineOptions {
  apiKey: string;
  fetch: FetchLike;
  /** Server environment; only `SR_ENGINE_MODEL` is read. */
  env?: EngineEnv;
  /** Explicit model id; wins over `env`. */
  model?: string;
}

export class AnthropicEngine implements Engine {
  readonly kind = "anthropic";
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;

  constructor(options: AnthropicEngineOptions) {
    if (!options.apiKey.trim()) throw new EngineError("upstream", "engine key missing");
    this.#apiKey = options.apiKey.trim();
    this.#fetch = options.fetch;
    this.model = options.model ?? engineModel(options.env ?? {});
  }

  async reply(req: EngineRequest): Promise<EngineReply> {
    let res: FetchResponse;
    try {
      res = await this.#fetch(MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.#apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(buildMessagesBody(req, this.model)),
      });
    } catch {
      throw new EngineError("upstream", "engine unreachable");
    }
    if (!res.ok) throw new EngineError("upstream", `engine answered HTTP ${res.status}`);
    const body = parseMessagesResponse(await res.text());
    if (body === undefined) throw new EngineError("upstream", "engine response is malformed");
    if (body.stopReason === "refusal") throw new EngineError("upstream", "engine declined the turn");
    const reply = parseReply(body.text);
    // Only an id that was actually in the chat sent can be answered.
    if (reply.answeredId !== undefined && !req.chat.some((m) => m.id === reply.answeredId)) {
      const { line, emotion, gesture } = reply;
      return { line, emotion, ...(gesture === undefined ? {} : { gesture }) };
    }
    return reply;
  }
}
