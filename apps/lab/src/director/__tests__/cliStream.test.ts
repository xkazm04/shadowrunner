import { describe, expect, it } from "vitest";
import { cliArgs, cliPrompt, CliStreamParser, toolCallSchema } from "../llm/cliStream.js";

// Lines shaped as `claude -p --output-format stream-json --verbose` printed them (2.1.318).
const delta = (d: object): string => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: d } });
const result = (extra: object): string =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "tool_use",
    total_cost_usd: 0.0003272,
    usage: { input_tokens: 2, cache_creation_input_tokens: 1335, cache_read_input_tokens: 0, output_tokens: 120 },
    ...extra,
  });

describe("cli transport, pure half", () => {
  it("builds print-mode arguments with no tools, settings or MCP", () => {
    const args = cliArgs({ system: "S", messages: [{ role: "user", content: "hi" }], schema: { type: "object" }, stream: true }, "claude-haiku-5-5");
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--strict-mcp-config"]));
    expect(args[args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("S");
    expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
  });

  it("refuses schema and tools together", () => {
    const tools = [{ name: "t", description: "d", input_schema: { type: "object" } }];
    expect(() => cliArgs({ system: "", messages: [], schema: {}, tools, stream: false }, "m")).toThrow("cannot combine");
  });

  it("renders history as a tagged transcript", () => {
    expect(cliPrompt([{ role: "user", content: "a" }])).toBe("a");
    expect(
      cliPrompt([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]),
    ).toContain('<turn role="assistant">\nb\n</turn>');
  });

  it("streams deltas, then the structured answer, usage and cost", () => {
    const p = new CliStreamParser(false);
    expect(p.line('{"type":"system","subtype":"init"}')).toEqual([]);
    expect(p.line(delta({ type: "input_json_delta", partial_json: '{"line": "Only' }))).toEqual([{ type: "jsonDelta", partial: '{"line": "Only' }]);
    expect(p.line(result({ structured_output: { line: "Only you.", emotion: "amused" } }))).toEqual([
      { type: "json", value: { line: "Only you.", emotion: "amused" } },
      { type: "usage", tokensIn: 1337, tokensOut: 120, costUsd: 0.0003272 },
      { type: "stop", reason: "tool_use" },
    ]);
    expect(() => p.finish("", 0)).not.toThrow();
  });

  it("turns emulated tool calls into toolCall chunks", () => {
    const schema = toolCallSchema([{ name: "light", description: "set the light", input_schema: { type: "object" } }]);
    expect(JSON.stringify(schema)).toContain('"const":"light"');
    const p = new CliStreamParser(true);
    const chunks = p.line(
      result({
        structured_output: {
          calls: [
            { name: "light", input: { cue: "dim" } },
            { name: "say", input: { text: "Hush." } },
          ],
        },
      }),
    );
    expect(chunks.filter((c) => c.type === "toolCall")).toEqual([
      { type: "toolCall", id: "cli-call-1", name: "light", input: { cue: "dim" } },
      { type: "toolCall", id: "cli-call-2", name: "say", input: { text: "Hush." } },
    ]);
  });

  it("raises CLI errors and a missing result", () => {
    expect(() => new CliStreamParser(false).line(result({ is_error: true, result: "Not logged in" }))).toThrow("Not logged in");
    expect(() => new CliStreamParser(false).finish("boom\n", 1)).toThrow("exit 1");
  });
});
