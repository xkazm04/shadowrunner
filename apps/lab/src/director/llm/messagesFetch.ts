// A `FetchLike` for @sr/engine's AnthropicEngine that answers the Messages API body through an
// LlmTransport instead of HTTP. C0 keeps the engine's prompt, schema and parseReply unchanged; only
// the wire differs. Fields the transport cannot express (thinking, effort) are dropped; the reply
// schema (output_config.format.schema) and model carry over.
import type { FetchInit, FetchLike, FetchResponse } from "@sr/engine";
import { isRecord, parseJson } from "../json.js";
import type { LlmMessage, LlmTransport } from "./types.js";

export interface MessagesUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
}

function messagesOf(value: unknown): LlmMessage[] {
  if (!Array.isArray(value)) return [];
  const out: LlmMessage[] = [];
  for (const m of value) {
    if (!isRecord(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** The system prompt: a string, or text blocks (the engine sends one cached block, perfection-pass 5) joined. */
function systemOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((b) => (isRecord(b) && b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("\n\n");
}

function schemaOf(body: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const config = body.output_config;
  if (!isRecord(config) || !isRecord(config.format)) return undefined;
  const schema = config.format.schema;
  return isRecord(schema) ? { ...schema } : undefined;
}

function respond(status: number, body: unknown): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** `onUsage` sees every completed call's tokens (and cost when the transport reports it). */
export function createMessagesFetch(
  transport: LlmTransport,
  onUsage: (usage: MessagesUsage) => void,
  onError: (error: unknown) => void = () => undefined,
): FetchLike {
  return async (_url: string, init: FetchInit): Promise<FetchResponse> => {
    const body = parseJson(init.body);
    if (!isRecord(body)) return respond(400, { error: { message: "body is not JSON" } });
    const schema = schemaOf(body);
    let text = "";
    let json: unknown;
    let stop = "end_turn";
    try {
      for await (const chunk of transport.complete({
        system: systemOf(body.system),
        messages: messagesOf(body.messages),
        ...(schema === undefined ? {} : { schema }),
        ...(typeof body.model === "string" ? { model: body.model } : {}),
        stream: false,
      })) {
        if (chunk.type === "text") text += chunk.text;
        else if (chunk.type === "json") json = chunk.value;
        else if (chunk.type === "stop") stop = chunk.reason;
        else if (chunk.type === "usage") {
          onUsage({ tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut, ...(chunk.costUsd === undefined ? {} : { costUsd: chunk.costUsd }) });
        }
      }
    } catch (error) {
      // The engine turns any non-2xx into EngineError("upstream"); the cause is reported here.
      onError(error);
      return respond(502, { error: { message: "transport failed" } });
    }
    const out = json === undefined ? text : JSON.stringify(json);
    // The CLI ends a structured answer with stop_reason "tool_use" (its StructuredOutput tool).
    return respond(200, { content: [{ type: "text", text: out }], stop_reason: stop === "refusal" ? "refusal" : "end_turn" });
  };
}
