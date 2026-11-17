// C0, the baseline control arm: today's product engine. @sr/engine's AnthropicEngine with its own
// persona prompt, REPLY_SCHEMA and parseReply, one call per chat message, yielding emotion, then
// gesture (if any), then the line. The wire under the engine is chosen by the context:
//   --llm api          the engine's own fetch to the Messages API with ANTHROPIC_API_KEY;
//   otherwise          the engine's Messages body answered by ctx.llm (llm/messagesFetch.ts):
//                      `claude -p` for --llm cli, the recorded turn for --control-fixture.
// A failed or unparseable reply counts as a control error and the turn stays silent.
import {
  AnthropicEngine,
  DEFAULT_ENGINE_MODEL,
  EngineError,
  type ChatMsg,
  type EngineReply,
  type EngineRequest,
  type FetchLike,
} from "@sr/engine";
import type { ChatMessage, ControlArm, Scenario } from "../../../contract.js";
import { isFiniteNumber, isRecord, parseJson } from "../../json.js";
import { createMessagesFetch, priceUsd } from "../../llm/index.js";
import { emptyUsage, type ControlArmFactory, type ControlContext, type ControlEvent } from "./types.js";

/** Global fetch, reading usage off each Messages API response on the way back. */
function meteredFetch(onUsage: (tokensIn: number, tokensOut: number) => void): FetchLike {
  return async (url, init) => {
    const res = await fetch(url, init);
    const text = await res.text();
    const body = parseJson(text);
    if (isRecord(body) && isRecord(body.usage)) {
      const u = body.usage;
      const n = (k: string): number => (isFiniteNumber(u[k]) ? u[k] : 0);
      onUsage(n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"), n("output_tokens"));
    }
    return { ok: res.ok, status: res.status, text: async () => text };
  };
}

/** The engine request for one chat message: every message so far as chat, this one picked. */
export function engineRequest(ctx: ControlContext, scenario: Scenario, chat: ChatMessage, beat: number): EngineRequest {
  const window: ChatMsg[] = scenario.chat
    .filter((m) => m.atMs <= chat.atMs)
    .map((m) => ({ id: m.id, user: m.user, text: m.text, ts: m.atMs, fictional: true }));
  return {
    characterId: scenario.character,
    persona: { characterId: scenario.character, name: scenario.title, bible: scenario.persona, voice: ctx.voice },
    chat: window,
    pickedId: chat.id,
    beat,
    seed: ctx.seed,
  };
}

/** Engine reply -> the arm's events (t is stamped by the director). */
export function replyEvents(reply: EngineReply, sayId: string): ControlEvent[] {
  return [
    { t: 0, kind: "emotion", value: reply.emotion },
    ...(reply.gesture === undefined ? [] : [{ t: 0, kind: "gesture" as const, value: reply.gesture }]),
    { t: 0, kind: "say", id: sayId, text: reply.line },
  ];
}

export const createC0: ControlArmFactory = (ctx) => {
  const usage = emptyUsage();
  const model = ctx.model ?? DEFAULT_ENGINE_MODEL;
  let beat = 0;
  const direct: FetchLike | undefined =
    ctx.llm.kind === "api" && ctx.apiKey !== undefined
      ? meteredFetch((tokensIn, tokensOut) => {
          usage.tokensIn += tokensIn;
          usage.tokensOut += tokensOut;
          usage.costUsd += priceUsd(model, tokensIn, tokensOut) ?? 0;
        })
      : undefined;
  /** The transport wire for one turn; `key` lets a fixture transport serve the recorded turn. */
  const viaTransport = (chatId: string): FetchLike =>
    createMessagesFetch(
      ctx.llm,
      (u) => {
        usage.tokensIn += u.tokensIn;
        usage.tokensOut += u.tokensOut;
        usage.costUsd += u.costUsd ?? 0;
      },
      (error) => ctx.log(`C0: transport failed: ${error instanceof Error ? error.message : String(error)}`),
      chatId,
    );

  const arm: ControlArm = {
    id: "C0",
    async *turn({ scenario, chat }) {
      beat += 1;
      const fetch = direct ?? viaTransport(chat.id);
      // The api path sends the real key; the transport paths (cli, fixture) never read it.
      const engine = new AnthropicEngine({ apiKey: ctx.apiKey ?? "lab-no-key", fetch, model });
      let reply: EngineReply;
      try {
        reply = await engine.reply(engineRequest(ctx, scenario, chat, beat));
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        usage.controlErrors += 1;
        ctx.log(`C0: turn ${chat.id} produced no reply (${error.message}).`);
        return;
      }
      yield* replyEvents(reply, `say-${chat.id}`);
    },
    usage: () => ({ ...usage }),
  };
  return arm;
};
