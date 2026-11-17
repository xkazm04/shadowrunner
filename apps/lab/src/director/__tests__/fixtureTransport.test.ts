// One replay wire for every control arm: a recorded fixture served as an LlmTransport (kind
// "fixture"), in whichever wire the request asks for (cue text, tool calls, REPLY_SCHEMA json).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { EMOTIONS, GESTURES, parseReply, REPLY_SCHEMA } from "@sr/engine";
import fc from "fast-check";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ControlArm, Scenario, SceneArgs, TimelineEvent } from "../../contract.js";
import { createC0 } from "../arms/control/c0.js";
import { createC1 } from "../arms/control/c1.js";
import { createC2 } from "../arms/control/c2.js";
import { CueStream } from "../arms/control/cues.js";
import { fixtureFile, loadFixture, parseFixture, type ControlFixture } from "../arms/control/fixture.js";
import type { ControlArmFactory, ControlContext, ControlEvent } from "../arms/control/index.js";
import { C2_TOOLS, validateCall } from "../arms/control/tools.js";
import { CANDLE_ACTIONS, CAPTION_STYLES, LIGHT_CUES } from "../arms/control/vocab.js";
import { createFixtureTransport } from "../llm/fixtureTransport.js";
import type { LlmChunk, LlmRequest, LlmTransport } from "../llm/index.js";
import { SCENARIOS_DIR } from "../paths.js";
import { performancesOf, repliesOf } from "../recordFixture.js";
import { loadScenario } from "../scenario.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const chatMsg = (id: string): Extract<TimelineEvent, { kind: "turn" }>["chat"] => ({ id, user: "u", text: "t", atMs: 0 });

/** The acceptance performance: two lines with the room direction between them. */
const timeline: TimelineEvent[] = [
  { t: 0, kind: "turn", turn: 1, chat: chatMsg("c1") },
  { t: 1, kind: "mark", name: "play:1" },
  { t: 2, kind: "emotion", value: "smug" },
  { t: 3, kind: "say", id: "say-c1-1", text: "a." },
  { t: 3, kind: "audio", id: "say-c1-1", sampleRate: 24000, pcmRef: "audio/say-c1-1.wav", durationMs: 400 },
  { t: 4, kind: "scene", op: "light", cue: "warm" },
  { t: 5, kind: "say", id: "say-c1-2", text: "b." },
];

const performance: ControlEvent[] = [
  { t: 0, kind: "emotion", value: "smug" },
  { t: 0, kind: "say", id: "say-c1-1", text: "a." },
  { t: 0, kind: "scene", op: "light", cue: "warm" },
  { t: 0, kind: "say", id: "say-c1-2", text: "b." },
];

const fixtureOf = (turns: Record<string, ControlEvent[]>): ControlFixture => parseFixture({ scenario: "haunt-01", source: "test", version: 2, turns }, "test");

async function drain(source: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const out: LlmChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

const request = (extra: Partial<LlmRequest>): LlmRequest => ({ system: "", messages: [], stream: true, ...extra });

const strip = (events: readonly ControlEvent[]): unknown[] =>
  events.map((e) => (e.kind === "say" ? { kind: e.kind, text: e.text } : { ...e, t: 0 }));

function context(llm: LlmTransport, extra: Partial<ControlContext> = {}): ControlContext {
  return { llm, voice: "clerk", seed: 1, log: () => undefined, ...extra };
}

async function play(arm: ControlArm, scenario: Scenario, index: number): Promise<ControlEvent[]> {
  const chat = scenario.chat[index];
  if (chat === undefined) throw new Error("no chat");
  const out: ControlEvent[] = [];
  for await (const e of arm.turn({ scenario, chat, history: [] })) out.push(e);
  return out;
}

describe("recording keeps the whole performance", () => {
  it("performancesOf keeps every line and the scene op, in order, as fixture turns", () => {
    expect(performancesOf(timeline)).toEqual({ c1: performance });
    const fixture = fixtureOf(performancesOf(timeline));
    expect(fixture.turns.c1).toEqual(performance);
    // The v2 file body (what `pnpm lab fixture` writes) loads back to the same turns.
    const file = fixtureFile(fixture);
    expect(JSON.stringify(file)).not.toContain('"t"');
    expect(parseFixture(file, "v2").turns).toEqual({ c1: performance });
  });

  it("GUARD: repliesOf (C0's view) still keeps the first line with its emotion", () => {
    expect(repliesOf(timeline)).toEqual({ c1: { line: "a.", emotion: "smug", answeredId: "c1" } });
  });
});

describe("the fixture transport", () => {
  it("serves a turn as tool calls in recorded order, then usage 0 and stop", async () => {
    const chunks = await drain(createFixtureTransport(fixtureOf({ c1: performance })).complete(request({ key: "c1", tools: [...C2_TOOLS] })));
    expect(chunks.map((c) => (c.type === "toolCall" ? [c.name, c.input] : c.type))).toEqual([
      ["emote", { emotion: "smug" }],
      ["say", { text: "a." }],
      ["light", { cue: "warm" }],
      ["say", { text: "b." }],
      "usage",
      "stop",
    ]);
    expect(chunks.at(-2)).toEqual({ type: "usage", tokensIn: 0, tokensOut: 0 });
  });

  const word = fc.stringMatching(/^[A-Za-z][a-z]{0,7}$/);
  const sentence = fc.tuple(fc.array(word, { minLength: 1, maxLength: 4 }), fc.constantFrom(".", "!", "?")).map(([w, end]) => `${w.join(" ")}${end}`);
  const sceneArb: fc.Arbitrary<SceneArgs> = fc.oneof(
    fc.constantFrom(...LIGHT_CUES).map((cue): SceneArgs => ({ op: "light", cue })),
    fc.constantFrom(...CANDLE_ACTIONS).map((action): SceneArgs => ({ op: "candles", action })),
    fc.constantFrom(...CAPTION_STYLES).map((style): SceneArgs => ({ op: "caption", style })),
    fc.tuple(word, fc.option(sentence, { nil: undefined }), fc.option(sentence, { nil: undefined })).map(
      ([id, title, body]): SceneArgs => ({ op: "card", action: "show", id, ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }) }),
    ),
    word.map((id): SceneArgs => ({ op: "card", action: "hide", id })),
    fc.tuple(sentence, fc.array(word, { minLength: 2, maxLength: 4 })).map(([question, options]): SceneArgs => ({ op: "poll", action: "open", question, options })),
    fc.constant<SceneArgs>({ op: "poll", action: "close" }),
  );
  const eventArb: fc.Arbitrary<ControlEvent> = fc.oneof(
    fc.constantFrom(...EMOTIONS).map((value): ControlEvent => ({ t: 0, kind: "emotion", value })),
    fc.constantFrom(...GESTURES).map((value): ControlEvent => ({ t: 0, kind: "gesture", value })),
    sentence.map((text): ControlEvent => ({ t: 0, kind: "say", id: "x", text })),
    sceneArb.map((args): ControlEvent => ({ t: 0, kind: "scene", ...args })),
  );

  it("serves a turn as cue text that CueStream parses back to the same events", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventArb, { minLength: 1, maxLength: 12 }), async (events) => {
        const chunks = await drain(createFixtureTransport(fixtureOf({ c1: events })).complete(request({ key: "c1" })));
        const parser = new CueStream();
        const pieces = [...chunks.flatMap((c) => (c.type === "text" ? parser.push(c.text) : [])), ...parser.end()];
        const parsed = pieces.map((p) =>
          p.type === "say" ? { kind: "say", text: p.text } : p.type === "error" ? p : p.cue.kind === "scene" ? { t: 0, kind: "scene", ...p.cue.args } : { t: 0, kind: p.cue.kind, value: p.cue.value },
        );
        expect(parsed).toEqual(strip(events));
        expect(chunks.slice(-2).map((c) => c.type)).toEqual(["usage", "stop"]);
      }),
      { numRuns: 200 },
    );
  });

  it("serves a turn as a REPLY_SCHEMA json value parseReply accepts, and C0 plays it through createMessagesFetch", async () => {
    const fixture = fixtureOf({ c2: [{ t: 0, kind: "gesture", value: "nod" }, ...performance] });
    const chunks = await drain(createFixtureTransport(fixture).complete(request({ key: "c2", schema: { ...REPLY_SCHEMA } })));
    const json = chunks.find((c) => c.type === "json");
    expect(json).toEqual({ type: "json", value: { line: "a.", emotion: "smug", gesture: "nod" } });
    expect(parseReply(JSON.stringify(json?.type === "json" ? json.value : null))).toEqual({ line: "a.", emotion: "smug", gesture: "nod" });
    const arm = createC0(context(createFixtureTransport(fixture)));
    expect(await play(arm, loadScenario("haunt-01"), 1)).toEqual([
      { t: 0, kind: "emotion", value: "smug" },
      { t: 0, kind: "gesture", value: "nod" },
      { t: 0, kind: "say", id: "say-c2", text: "a." },
    ]);
    expect(arm.usage()).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0, controlErrors: 0 });
  });

  it("throws a sentence naming the chat id for a missing turn; every arm counts exactly one control error", async () => {
    const fixture = fixtureOf({ c1: performance });
    await expect(drain(createFixtureTransport(fixture).complete(request({ key: "missing" })))).rejects.toThrow('"missing"');
    const scenario = loadScenario("haunt-01");
    for (const factory of [createC0, createC1, createC2]) {
      const arm = factory(context(createFixtureTransport(fixture)));
      expect(await play(arm, scenario, 2)).toEqual([]);
      expect(arm.usage().controlErrors).toBe(1);
    }
  });
});

describe("committed v1 fixtures", () => {
  const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".fixture.json"));

  it("every committed fixture still loads and plays through C0, C1 and C2 with today's events", async () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const fixture = loadFixture(join(SCENARIOS_DIR, file));
      const scenario = loadScenario(fixture.scenario);
      const arms = { C0: createC0, C1: createC1, C2: createC2 } satisfies Record<string, ControlArmFactory>;
      const built = Object.fromEntries(Object.entries(arms).map(([id, f]) => [id, f(context(createFixtureTransport(fixture)))]));
      for (const [i, chat] of scenario.chat.entries()) {
        const reply = fixture.replies[chat.id];
        if (reply === undefined) continue;
        // Today's per-arm adapters, pinned: C0 replies as-is, C1 as tags, C2 as calls.
        const c0: ControlEvent[] = [
          { t: 0, kind: "emotion", value: reply.emotion },
          ...(reply.gesture === undefined ? [] : [{ t: 0, kind: "gesture" as const, value: reply.gesture }]),
          { t: 0, kind: "say", id: `say-${chat.id}`, text: reply.line },
        ];
        const parser = new CueStream();
        const tagged = `[${reply.emotion}] ${reply.gesture === undefined ? "" : `[gesture ${reply.gesture}] `}${reply.line}`;
        let n = 0;
        const c1 = [...parser.push(tagged), ...parser.end()].flatMap((p): ControlEvent[] => {
          if (p.type === "say") return [{ t: 0, kind: "say", id: `say-${chat.id}-${(n += 1)}`, text: p.text }];
          if (p.type !== "cue") return [];
          if (p.cue.kind === "emotion") return [{ t: 0, kind: "emotion", value: p.cue.value }];
          return p.cue.kind === "gesture" ? [{ t: 0, kind: "gesture", value: p.cue.value }] : [];
        });
        const calls: [string, unknown][] = [["emote", { emotion: reply.emotion }], ...(reply.gesture === undefined ? [] : [["gesture", { name: reply.gesture }] as [string, unknown]]), ["say", { text: reply.line }]];
        const c2 = calls.flatMap(([name, input]) => {
          const e = validateCall(name, input, `say-${chat.id}-1`);
          return typeof e === "string" ? [] : [e];
        });
        expect(await play(built.C0 as ControlArm, scenario, i), `${file} C0 ${chat.id}`).toEqual(c0);
        expect(await play(built.C1 as ControlArm, scenario, i), `${file} C1 ${chat.id}`).toEqual(c1);
        expect(await play(built.C2 as ControlArm, scenario, i), `${file} C2 ${chat.id}`).toEqual(c2);
      }
    }
  });
});

describe("arms over a fixture transport", () => {
  it("make zero calls to any other transport, and ControlContext has no fixture field", async () => {
    const fixture = fixtureOf({ c1: performance });
    const fetchSpy = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const scenario = loadScenario("haunt-01");
    let calls = 0;
    const inner = createFixtureTransport(fixture);
    const llm: LlmTransport = {
      kind: inner.kind,
      complete(req) {
        calls += 1;
        return inner.complete(req);
      },
    };
    for (const factory of [createC0, createC1, createC2]) {
      const arm = factory(context(llm, { apiKey: "sk-test" }));
      expect((await play(arm, scenario, 0)).length).toBeGreaterThan(0);
    }
    expect(calls).toBe(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectTypeOf<ControlContext>().not.toHaveProperty("fixture");
    const ctx = context(llm);
    // @ts-expect-error -- the fixture is a transport now, not a context field.
    expect(ctx.fixture).toBeUndefined();
  });
});
