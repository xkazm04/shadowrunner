import { describe, expect, it } from "vitest";
import type { ChatMessage, ControlArm } from "../../contract.js";
import { createC1 } from "../arms/control/c1.js";
import { createC2 } from "../arms/control/c2.js";
import { parseFixture } from "../arms/control/fixture.js";
import { createControlArm, type ControlContext, type ControlEvent } from "../arms/control/index.js";
import { C2_TOOLS, validateCall } from "../arms/control/tools.js";
import { toolCallSchema } from "../llm/cliStream.js";
import type { LlmChunk, LlmRequest, LlmTransport } from "../llm/index.js";
import { loadScenario } from "../scenario.js";

const scenario = loadScenario("haunt-01");
const first = scenario.chat[0];
if (first === undefined) throw new Error("no chat");
const chat: ChatMessage = first;

function context(llm: LlmTransport, extra: Partial<ControlContext> = {}): ControlContext {
  return { llm, voice: "clerk", seed: 1, log: () => undefined, ...extra };
}

/** A transport that yields `chunks` and records, per chunk, how many events the arm had emitted. */
function scripted(chunks: LlmChunk[], seen: LlmRequest[] = []): LlmTransport {
  return {
    kind: "cli",
    async *complete(req) {
      seen.push(req);
      yield* chunks;
    },
  };
}

async function collect(arm: ControlArm): Promise<ControlEvent[]> {
  const out: ControlEvent[] = [];
  for await (const e of arm.turn({ scenario, chat, history: [] })) out.push(e);
  return out;
}

const usage: LlmChunk = { type: "usage", tokensIn: 300, tokensOut: 40, costUsd: 0.002 };

describe("C1 over a streaming transport", () => {
  it("streams text, yields say lines before the turn ends, and meters usage", async () => {
    const seen: LlmRequest[] = [];
    let finished = false;
    // The model holds the rest of its turn until the test has seen the first line.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm: LlmTransport = {
      kind: "cli",
      async *complete(req) {
        seen.push(req);
        yield { type: "text", text: "[smug 0.6] Name rec" };
        yield { type: "text", text: "orded. [light warm] Do not" };
        await gate;
        yield { type: "text", text: " wander off." };
        yield usage;
        finished = true;
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const arm = createC1(context(llm));
    const out: { event: ControlEvent; finished: boolean }[] = [];
    for await (const event of arm.turn({ scenario, chat, history: [] })) {
      out.push({ event, finished });
      if (event.kind === "say") release();
    }
    expect(out.map((o) => o.event)).toEqual([
      { t: 0, kind: "emotion", value: "smug" },
      { t: 0, kind: "say", id: "say-c1-1", text: "Name recorded." },
      { t: 0, kind: "scene", op: "light", cue: "warm" },
      { t: 0, kind: "say", id: "say-c1-2", text: "Do not wander off." },
    ]);
    expect(out[1]?.finished).toBe(false); // the first line left before the transport finished
    expect(seen[0]).toMatchObject({ stream: true, model: "claude-haiku-5-5" });
    expect(seen[0]?.schema).toBeUndefined();
    expect(seen[0]?.system).toContain("You are The Tallyman");
    expect(seen[0]?.system).toContain("[light dim|warm|cold|flicker|blackout]");
    expect(seen[0]?.system).not.toContain("Answer with one spoken line");
    expect(seen[0]?.messages[0]?.content).toContain('Answer the chat message with id "c1"');
    expect(arm.usage()).toEqual({ tokensIn: 300, tokensOut: 40, costUsd: 0.002, controlErrors: 0 });
  });

  it("counts malformed tags, a failed transport and a silent turn as control errors", async () => {
    const bad = createC1(context(scripted([{ type: "text", text: "[dance] Hello. [light purple]" }, usage])));
    expect((await collect(bad)).filter((e) => e.kind === "say")).toHaveLength(1);
    expect(bad.usage().controlErrors).toBe(2);
    const failing = createC1(
      context({
        kind: "cli",
        async *complete() {
          yield { type: "text", text: "Half a line" };
          throw new Error("CLI died");
        },
      }),
    );
    expect(await collect(failing)).toEqual([{ t: 0, kind: "say", id: "say-c1-1", text: "Half a line" }]);
    expect(failing.usage().controlErrors).toBe(1);
    const silent = createC1(context(scripted([{ type: "text", text: "[grim]" }])));
    expect(await collect(silent)).toEqual([{ t: 0, kind: "emotion", value: "grim" }]);
    expect(silent.usage().controlErrors).toBe(1);
  });

  it("plays a recorded fixture through its grammar with no model call", async () => {
    const fixture = parseFixture({ scenario: "haunt-01", source: "t", replies: { c1: { line: "Counted.", emotion: "delighted", gesture: "nod" } } }, "f");
    const arm = createC1(context(scripted([]), { fixture }));
    expect(await collect(arm)).toEqual([
      { t: 0, kind: "emotion", value: "delighted" },
      { t: 0, kind: "gesture", value: "nod" },
      { t: 0, kind: "say", id: "say-c1-1", text: "Counted." },
    ]);
  });
});

describe("C2 validation", () => {
  it("accepts every tool with valid input", () => {
    expect(validateCall("say", { text: "  One  soul. " }, "s")).toEqual({ t: 0, kind: "say", id: "s", text: "One soul." });
    expect(validateCall("emote", { emotion: "smug", intensity: 0.4 }, "s")).toEqual({ t: 0, kind: "emotion", value: "smug" });
    expect(validateCall("gesture", { name: "glare" }, "s")).toEqual({ t: 0, kind: "gesture", value: "glare" });
    expect(validateCall("light", { cue: "flicker" }, "s")).toEqual({ t: 0, kind: "scene", op: "light", cue: "flicker" });
    expect(validateCall("candles", { action: "burst" }, "s")).toEqual({ t: 0, kind: "scene", op: "candles", action: "burst" });
    expect(validateCall("caption", { style: "shout" }, "s")).toEqual({ t: 0, kind: "scene", op: "caption", style: "shout" });
    expect(validateCall("card", { action: "show", id: "census", title: "Census", body: "12" }, "s")).toEqual({
      t: 0, kind: "scene", op: "card", action: "show", id: "census", title: "Census", body: "12",
    });
    expect(validateCall("poll", { action: "open", question: "Q?", options: ["a", "b"] }, "s")).toEqual({
      t: 0, kind: "scene", op: "poll", action: "open", question: "Q?", options: ["a", "b"],
    });
  });

  it("rejects unknown tools, bad enums and missing text", () => {
    const bad: [string, unknown][] = [
      ["dance", {}],
      ["say", {}],
      ["say", { text: "   " }],
      ["say", "hello"],
      ["emote", { emotion: "sad" }],
      ["emote", { emotion: "smug", intensity: 2 }],
      ["gesture", { name: "wave" }],
      ["light", { cue: "purple" }],
      ["candles", { action: "explode" }],
      ["caption", { style: "sing" }],
      ["card", { action: "show", id: "two words" }],
      ["card", { action: "flip", id: "census" }],
      ["poll", { action: "open", question: "Q?", options: ["only"] }],
      ["poll", { action: "open", options: ["a", "b"] }],
    ];
    for (const [name, input] of bad) expect(typeof validateCall(name, input, "s"), `${name} ${JSON.stringify(input)}`).toBe("string");
  });

  it("declares tools the cli transport can emulate", () => {
    const schema = toolCallSchema(C2_TOOLS);
    expect(JSON.stringify(schema)).toContain('"const":"poll"');
    expect(C2_TOOLS.map((t) => t.name)).toEqual(["say", "emote", "gesture", "light", "candles", "card", "caption", "poll"]);
  });
});

describe("C2 over a transport", () => {
  it("sends tools, yields valid calls in order, skips and counts invalid ones", async () => {
    const seen: LlmRequest[] = [];
    const call = (n: number, name: string, input: unknown): LlmChunk => ({ type: "toolCall", id: `cli-call-${n}`, name, input });
    const arm = createC2(
      context(
        scripted(
          [
            call(1, "emote", { emotion: "irritated" }),
            call(2, "light", { cue: "dim" }),
            call(3, "say", { text: "Lights down." }),
            call(4, "summon", { who: "ghost" }),
            call(5, "caption", { style: "loud" }),
            call(6, "say", { text: "Better." }),
            usage,
          ],
          seen,
        ),
      ),
    );
    expect(await collect(arm)).toEqual([
      { t: 0, kind: "emotion", value: "irritated" },
      { t: 0, kind: "scene", op: "light", cue: "dim" },
      { t: 0, kind: "say", id: "say-c1-1", text: "Lights down." },
      { t: 0, kind: "say", id: "say-c1-2", text: "Better." },
    ]);
    expect(arm.usage()).toEqual({ tokensIn: 300, tokensOut: 40, costUsd: 0.002, controlErrors: 2 });
    expect(seen[0]?.tools?.map((t) => t.name)).toContain("card");
    expect(seen[0]?.schema).toBeUndefined();
    expect(seen[0]?.system).toContain("tool calls");
  });

  it("counts a turn with no say as a control error; the registry builds C1 and C2", async () => {
    const arm = createC2(context(scripted([{ type: "toolCall", id: "x", name: "emote", input: { emotion: "grim" } }])));
    await collect(arm);
    expect(arm.usage().controlErrors).toBe(1);
    expect(createControlArm("C1", context(scripted([]))).id).toBe("C1");
    expect(createControlArm("C2", context(scripted([]))).id).toBe("C2");
  });
});

describe("eager", () => {
  it("drains its source while the consumer is busy and reports the end", async () => {
    const { eager } = await import("../arms/control/c1.js");
    let ended = false;
    async function* source(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    const it = eager(source(), () => {
      ended = true;
    });
    expect((await it.next()).value).toBe(1);
    await new Promise((r) => setTimeout(r, 0)); // the consumer is "voicing" line 1
    expect(ended).toBe(true);
    const rest: number[] = [];
    for await (const n of it) rest.push(n);
    expect(rest).toEqual([2, 3]);
  });
});
