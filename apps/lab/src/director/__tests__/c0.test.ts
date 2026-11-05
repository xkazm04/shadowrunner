import { describe, expect, it } from "vitest";
import type { ControlArm } from "../../contract.js";
import { createC0 } from "../arms/control/c0.js";
import { parseFixture } from "../arms/control/fixture.js";
import type { ControlContext, ControlEvent } from "../arms/control/index.js";
import type { LlmChunk, LlmRequest, LlmTransport } from "../llm/index.js";
import { loadScenario } from "../scenario.js";

const scenario = loadScenario("haunt-01");

function context(llm: LlmTransport, extra: Partial<ControlContext> = {}): ControlContext {
  return { llm, voice: "clerk", seed: 1, log: () => undefined, ...extra };
}

async function turn(arm: ControlArm, index: number): Promise<ControlEvent[]> {
  const out: ControlEvent[] = [];
  const chat = scenario.chat[index];
  if (chat === undefined) throw new Error("no chat");
  for await (const e of arm.turn({ scenario, chat, history: [] })) out.push(e);
  return out;
}

function fakeTransport(answer: (req: LlmRequest) => LlmChunk[], seen: LlmRequest[] = []): LlmTransport {
  return {
    kind: "cli",
    async *complete(req) {
      seen.push(req);
      yield* answer(req);
    },
  };
}

const modelCalled = (): LlmChunk[] => {
  throw new Error("model called");
};

describe("C0 over a transport", () => {
  it("sends the engine's persona prompt and schema, yields emotion, gesture, say, and meters usage", async () => {
    const seen: LlmRequest[] = [];
    const answer = (): LlmChunk[] => [
      { type: "json", value: { line: "One soul, counted.", emotion: "delighted", gesture: "nod", answeredId: "c1" } },
      { type: "usage", tokensIn: 100, tokensOut: 20, costUsd: 0.001 },
      { type: "stop", reason: "tool_use" },
    ];
    const arm = createC0(context(fakeTransport(answer, seen)));
    expect(await turn(arm, 0)).toEqual([
      { t: 0, kind: "emotion", value: "delighted" },
      { t: 0, kind: "gesture", value: "nod" },
      { t: 0, kind: "say", id: "say-c1", text: "One soul, counted." },
    ]);
    expect(seen[0]?.system).toContain("You are The Tallyman");
    expect(seen[0]?.schema).toMatchObject({ required: ["line", "emotion"] });
    expect(seen[0]?.messages[0]?.content).toContain('Answer the chat message with id "c1"');
    expect(seen[0]?.model).toBe("claude-haiku-5-5");
    expect(arm.usage()).toEqual({ tokensIn: 100, tokensOut: 20, costUsd: 0.001, controlErrors: 0 });
  });

  it("counts a transport failure or a junk reply as a control error and stays silent", async () => {
    const failing = createC0(context(fakeTransport(modelCalled)));
    expect(await turn(failing, 0)).toEqual([]);
    const junk = createC0(context(fakeTransport(() => [{ type: "text", text: "not json" }])));
    expect(await turn(junk, 1)).toEqual([]);
    expect(failing.usage().controlErrors + junk.usage().controlErrors).toBe(2);
  });
});

describe("C0 over a fixture", () => {
  it("replays recorded replies with no model call", async () => {
    const fixture = parseFixture({ scenario: "haunt-01", source: "test", replies: { c2: { line: "Noted.", emotion: "smug" } } }, "f");
    const arm = createC0(context(fakeTransport(modelCalled), { fixture }));
    expect(await turn(arm, 1)).toEqual([
      { t: 0, kind: "emotion", value: "smug" },
      { t: 0, kind: "say", id: "say-c2", text: "Noted." },
    ]);
    expect(await turn(arm, 2)).toEqual([]);
    expect(arm.usage()).toMatchObject({ tokensIn: 0, controlErrors: 1 });
  });

  it("rejects a malformed fixture with a sentence", () => {
    expect(() => parseFixture({ scenario: "x", source: "y", replies: { c1: { line: "a", emotion: "sleepy" } } }, "f.json")).toThrow("f.json: replies.c1");
  });
});
