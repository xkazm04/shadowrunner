// Pure half of the `cli` transport: the request -> `claude -p` arguments, and the CLI's
// `--output-format stream-json` lines -> LlmChunks. Verified against claude 2.1.318 (2026-11-05).
//
// Tools: the CLI cannot declare arbitrary client tools (`--tools` names built-ins only). They are
// emulated through `--json-schema`: the model answers `{ text?, calls: [{ name, input }] }`, each
// call constrained by `anyOf` over the tools' input schemas, and every call becomes a `toolCall`
// chunk. The difference from real tool use: calls arrive together at the end of the turn, there is
// no tool_result round trip within one complete(), and the ids are synthetic (`cli-call-<n>`).
import { isFiniteNumber, isRecord } from "../json.js";
import type { LlmChunk, LlmMessage, LlmRequest, LlmTool } from "./types.js";

/** The structured-output schema that carries tool calls for the CLI. */
export function toolCallSchema(tools: readonly LlmTool[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["calls"],
    properties: {
      text: { type: "string", description: "Optional words outside any tool call." },
      calls: {
        type: "array",
        description: "The tool calls to make, in order.",
        items: {
          anyOf: tools.map((tool) => ({
            type: "object",
            additionalProperties: false,
            required: ["name", "input"],
            description: tool.description,
            properties: { name: { const: tool.name }, input: tool.input_schema },
          })),
        },
      },
    },
  };
}

const TOOL_NOTE =
  "\n\nYou act through tools. Reply with the structured output: `calls` lists each tool call as { name, input }, in order.";

/** The prompt text: one user message as-is; a longer history as a tagged transcript. */
export function cliPrompt(messages: readonly LlmMessage[]): string {
  if (messages.length === 1 && messages[0]?.role === "user") return messages[0].content;
  return messages.map((m) => `<turn role="${m.role}">\n${m.content}\n</turn>`).join("\n");
}

/** Arguments for `claude` (the prompt itself goes to stdin). */
export function cliArgs(request: LlmRequest, model: string): string[] {
  if (request.schema !== undefined && request.tools !== undefined && request.tools.length > 0) {
    throw new Error("The cli transport cannot combine a structured-output schema with tools; pass one of them.");
  }
  const tools = request.tools !== undefined && request.tools.length > 0 ? request.tools : undefined;
  const schema = tools === undefined ? request.schema : toolCallSchema(tools);
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--tools",
    "",
    "--system-prompt",
    tools === undefined ? request.system : request.system + TOOL_NOTE,
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
  ];
  if (request.stream) args.push("--include-partial-messages");
  if (schema !== undefined) args.push("--json-schema", JSON.stringify(schema));
  return args;
}

/** Turns stream-json lines into chunks. Feed every stdout line; `finish()` once stdout closes. */
export class CliStreamParser {
  readonly #toolMode: boolean;
  #sawText = false;
  #sawResult = false;
  #calls = 0;

  constructor(toolMode: boolean) {
    this.#toolMode = toolMode;
  }

  line(text: string): LlmChunk[] {
    const trimmed = text.trim();
    if (trimmed === "") return [];
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
    if (!isRecord(value)) return [];
    if (value.type === "stream_event") return this.#streamEvent(value.event);
    if (value.type === "result") return this.#result(value);
    return [];
  }

  /** Throws when the CLI ended without a result line. */
  finish(stderr: string, exitCode: number | null): void {
    if (this.#sawResult) return;
    const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
    throw new Error(`claude CLI ended (exit ${exitCode ?? "signal"}) without a result${detail ? `: ${detail}` : "."}`);
  }

  #streamEvent(event: unknown): LlmChunk[] {
    if (!isRecord(event) || event.type !== "content_block_delta" || !isRecord(event.delta)) return [];
    const { delta } = event;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      this.#sawText = true;
      return [{ type: "text", text: delta.text }];
    }
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && delta.partial_json !== "") {
      return [{ type: "jsonDelta", partial: delta.partial_json }];
    }
    return [];
  }

  #result(value: Readonly<Record<string, unknown>>): LlmChunk[] {
    this.#sawResult = true;
    if (value.is_error === true) {
      const why = typeof value.result === "string" ? value.result : String(value.subtype ?? "error");
      throw new Error(`claude CLI returned an error: ${why.slice(0, 400)}`);
    }
    const out: LlmChunk[] = [];
    const structured = value.structured_output;
    if (structured !== undefined && this.#toolMode) out.push(...this.#toolCalls(structured));
    else if (structured !== undefined) out.push({ type: "json", value: structured });
    else if (!this.#sawText && typeof value.result === "string") out.push({ type: "text", text: value.result });
    const usage = isRecord(value.usage) ? value.usage : {};
    const n = (k: string): number => (isFiniteNumber(usage[k]) ? usage[k] : 0);
    const cost = value.total_cost_usd;
    out.push({
      type: "usage",
      tokensIn: n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
      tokensOut: n("output_tokens"),
      ...(isFiniteNumber(cost) ? { costUsd: cost } : {}),
    });
    out.push({ type: "stop", reason: typeof value.stop_reason === "string" ? value.stop_reason : "end_turn" });
    return out;
  }

  #toolCalls(structured: unknown): LlmChunk[] {
    if (!isRecord(structured) || !Array.isArray(structured.calls)) {
      throw new Error("claude CLI structured output carries no `calls` array.");
    }
    const out: LlmChunk[] = [];
    if (typeof structured.text === "string" && structured.text !== "") out.push({ type: "text", text: structured.text });
    for (const call of structured.calls) {
      if (!isRecord(call) || typeof call.name !== "string") continue;
      this.#calls += 1;
      out.push({ type: "toolCall", id: `cli-call-${this.#calls}`, name: call.name, input: call.input });
    }
    return out;
  }
}
