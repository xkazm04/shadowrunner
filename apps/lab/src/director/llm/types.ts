// The lab's one LLM seam: `complete()` streams chunks from either transport (--llm api|cli).
// Arms never talk to a transport's wire format; they read these chunks.

export type LlmKind = "api" | "cli";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** A client tool, as the Messages API declares one. */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the tool input (an object schema). */
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  /** Structured output: the final answer is one JSON value matching this schema (a `json` chunk). */
  schema?: Record<string, unknown>;
  /** Client tools; each call arrives as a `toolCall` chunk. Not combinable with `schema`. */
  tools?: LlmTool[];
  /** Stream partial output as it is generated (`text` / `jsonDelta` chunks); final chunks always come. */
  stream: boolean;
  /** Model id; each transport has a default. */
  model?: string;
  maxTokens?: number;
}

export type LlmChunk =
  | { type: "text"; text: string }
  | { type: "jsonDelta"; partial: string }
  | { type: "json"; value: unknown }
  | { type: "toolCall"; id: string; name: string; input: unknown }
  | { type: "usage"; tokensIn: number; tokensOut: number; costUsd?: number }
  | { type: "stop"; reason: string };

export interface LlmTransport {
  readonly kind: LlmKind;
  complete(request: LlmRequest): AsyncIterable<LlmChunk>;
}

export const DEFAULT_LAB_MODEL = "claude-haiku-5-5";

/** List prices per million tokens (input, output), for the api transport's cost estimate. */
export const PRICE_PER_MTOK: Readonly<Record<string, readonly [number, number]>> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

/** USD for a call from list prices; undefined for a model without a price here. */
export function priceUsd(model: string, tokensIn: number, tokensOut: number): number | undefined {
  const price = PRICE_PER_MTOK[model];
  return price === undefined ? undefined : (tokensIn * price[0] + tokensOut * price[1]) / 1_000_000;
}
