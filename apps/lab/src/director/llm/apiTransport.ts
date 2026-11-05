// `api` transport: @anthropic-ai/sdk Messages, streaming. The key is ANTHROPIC_API_KEY, read by the
// director only; nothing here reaches the page bundle. Cost is estimated from list prices
// (types.ts PRICE_PER_MTOK) and omitted for a model without one.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_LAB_MODEL, priceUsd, type LlmChunk, type LlmRequest, type LlmTransport } from "./types.js";

export interface ApiTransportOptions {
  apiKey: string;
  model?: string;
}

export function createApiTransport(options: ApiTransportOptions): LlmTransport {
  if (options.apiKey.trim() === "") throw new Error("The api transport needs ANTHROPIC_API_KEY; use --llm cli without one.");
  const client = new Anthropic({ apiKey: options.apiKey.trim() });
  return {
    kind: "api",
    async *complete(request: LlmRequest): AsyncIterable<LlmChunk> {
      const model = request.model ?? options.model ?? DEFAULT_LAB_MODEL;
      const stream = client.messages.stream({
        model,
        max_tokens: request.maxTokens ?? 1024,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: {
          effort: "low",
          ...(request.schema === undefined ? {} : { format: { type: "json_schema", schema: request.schema } }),
        },
        ...(request.tools === undefined || request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: { ...t.input_schema, type: "object" as const },
                eager_input_streaming: true,
              })),
            }),
      });
      if (request.stream) {
        for await (const event of stream) {
          if (event.type !== "content_block_delta") continue;
          if (event.delta.type === "text_delta") yield { type: "text", text: event.delta.text };
          else if (event.delta.type === "input_json_delta" && event.delta.partial_json !== "") {
            yield { type: "jsonDelta", partial: event.delta.partial_json };
          }
        }
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new Error("The model declined the turn (stop_reason refusal).");
      let text = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") yield { type: "toolCall", id: block.id, name: block.name, input: block.input };
      }
      if (request.schema !== undefined) {
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new Error("The model's structured output is not JSON.");
        }
        yield { type: "json", value };
      } else if (!request.stream && text !== "") {
        yield { type: "text", text };
      }
      const u = message.usage;
      const tokensIn = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      const cost = priceUsd(model, tokensIn, u.output_tokens);
      yield { type: "usage", tokensIn, tokensOut: u.output_tokens, ...(cost === undefined ? {} : { costUsd: cost }) };
      yield { type: "stop", reason: message.stop_reason ?? "end_turn" };
    },
  };
}
