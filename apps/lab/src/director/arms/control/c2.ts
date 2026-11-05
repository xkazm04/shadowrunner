// C2, tool calls: the model performs through say / emote / gesture and one tool per scene op
// (tools.ts). Every call is validated against the contract enums before it becomes an event;
// an invalid call is skipped and counted as a control error. Over the `api` transport these are
// real client tools; over `cli` they are emulated through a JSON schema (llm/cliStream.ts), so
// all calls arrive together at turn end. Either way C2 yields each call as its chunk arrives, so a
// transport that streams tool_use blocks one by one gets voiced call by call with no change here.
// No tool_result round trip: one complete() per turn, like C0. Same model as C0 by default.
import { DEFAULT_ENGINE_MODEL } from "@sr/engine";
import type { ControlArm } from "../../../contract.js";
import { engineRequest } from "./c0.js";
import { addUsage } from "./c1.js";
import type { ControlFixture } from "./fixture.js";
import { c2System, turnText } from "./prompts.js";
import { C2_TOOLS, validateCall } from "./tools.js";
import { emptyUsage, type ControlArmFactory } from "./types.js";

/** A recorded C0 reply as C2 tool calls (the fixture path: no model call). */
export function fixtureCalls(fixture: ControlFixture, chatId: string): { name: string; input: unknown }[] {
  const reply = fixture.replies[chatId];
  if (reply === undefined) return [];
  return [
    { name: "emote", input: { emotion: reply.emotion } },
    ...(reply.gesture === undefined ? [] : [{ name: "gesture", input: { name: reply.gesture } }]),
    { name: "say", input: { text: reply.line } },
  ];
}

export const createC2: ControlArmFactory = (ctx) => {
  const usage = emptyUsage();
  const model = ctx.model ?? DEFAULT_ENGINE_MODEL;
  let beat = 0;

  const arm: ControlArm = {
    id: "C2",
    async *turn({ scenario, chat }) {
      beat += 1;
      let lines = 0;
      const accept = (name: string, input: unknown) => {
        const event = validateCall(name, input, `say-${chat.id}-${lines + 1}`);
        if (typeof event === "string") {
          usage.controlErrors += 1;
          ctx.log(`C2: ${chat.id} skipped call ${name} (${event}).`);
          return undefined;
        }
        if (event.kind === "say") lines += 1;
        return event;
      };

      if (ctx.fixture !== undefined) {
        for (const call of fixtureCalls(ctx.fixture, chat.id)) {
          const event = accept(call.name, call.input);
          if (event !== undefined) yield event;
        }
      } else {
        const request = engineRequest(ctx, scenario, chat, beat);
        try {
          for await (const chunk of ctx.llm.complete({
            system: c2System(request.persona),
            messages: [{ role: "user", content: turnText(request) }],
            tools: [...C2_TOOLS],
            stream: true,
            model,
            maxTokens: 800,
          })) {
            if (chunk.type === "toolCall") {
              const event = accept(chunk.name, chunk.input);
              if (event !== undefined) yield event;
            } else if (chunk.type === "usage") {
              addUsage(usage, chunk);
            }
          }
        } catch (error) {
          usage.controlErrors += 1;
          ctx.log(`C2: turn ${chat.id} transport failed (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      if (lines === 0) {
        usage.controlErrors += 1;
        ctx.log(`C2: turn ${chat.id} produced no spoken line.`);
      }
    },
    usage: () => ({ ...usage }),
  };
  return arm;
};
