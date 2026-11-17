// C1, inline cue grammar, streamed: the model writes its speech with direction tags (cues.ts) as
// plain text, streamed from the transport (`stream: true`; the cli transport passes
// --include-partial-messages). The transport is drained eagerly and each text chunk goes through
// CueStream, so the first sentence is voiced while the model is still writing the rest. Malformed tags are counted as control errors;
// a turn whose transport fails, or that speaks nothing, counts one. --control-fixture replays through
// this same path (llm/fixtureTransport.ts writes the recorded turn as cue text). Same model as C0 by default.
import { DEFAULT_ENGINE_MODEL } from "@sr/engine";
import type { ControlArm } from "../../../contract.js";
import { engineRequest } from "./c0.js";
import { CueStream, type CuePiece } from "./cues.js";
import { c1System, turnText } from "./prompts.js";
import { emptyUsage, type ControlArmFactory, type ControlEvent, type ControlUsage } from "./types.js";

/** Adds a transport usage chunk to the arm's totals. */
export function addUsage(usage: ControlUsage, chunk: { tokensIn: number; tokensOut: number; costUsd?: number }): void {
  usage.tokensIn += chunk.tokensIn;
  usage.tokensOut += chunk.tokensOut;
  usage.costUsd += chunk.costUsd ?? 0;
}

/**
 * Reads `source` to its end at its own pace, whatever the consumer's (the director voices each line
 * before it pulls the next event), and yields what it read in order. `onEnd` fires when the
 * source is exhausted or fails, so the model's finish time is measured, not the voicing's.
 */
export async function* eager<T>(source: AsyncIterable<T>, onEnd: () => void = () => undefined): AsyncGenerator<T> {
  const queue: T[] = [];
  let done = false;
  let failure: { error: unknown } | undefined;
  let wake: (() => void) | undefined;
  void (async () => {
    try {
      for await (const item of source) {
        queue.push(item);
        wake?.();
      }
    } catch (error) {
      failure = { error };
    } finally {
      done = true;
      onEnd();
      wake?.();
    }
  })();
  for (;;) {
    const item = queue.shift();
    if (item !== undefined) {
      yield item;
      continue;
    }
    if (done) {
      if (failure !== undefined) throw failure.error;
      return;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = undefined;
  }
}

export const createC1: ControlArmFactory = (ctx) => {
  const usage = emptyUsage();
  const model = ctx.model ?? DEFAULT_ENGINE_MODEL;
  let beat = 0;

  const arm: ControlArm = {
    id: "C1",
    async *turn({ scenario, chat }) {
      beat += 1;
      const parser = new CueStream();
      let lines = 0;
      let intensityDropped = 0;
      let firstLineMs: number | undefined;
      const events = function* (pieces: CuePiece[]): Generator<ControlEvent> {
        for (const piece of pieces) {
          if (piece.type === "error") {
            usage.controlErrors += 1;
            ctx.log(`C1: ${chat.id} dropped tag ${piece.tag} (${piece.reason}).`);
          } else if (piece.type === "say") {
            lines += 1;
            yield { t: 0, kind: "say", id: `say-${chat.id}-${lines}`, text: piece.text };
          } else if (piece.cue.kind === "emotion") {
            if (piece.cue.intensity !== undefined) intensityDropped += 1;
            yield { t: 0, kind: "emotion", value: piece.cue.value };
          } else if (piece.cue.kind === "gesture") {
            yield { t: 0, kind: "gesture", value: piece.cue.value };
          } else {
            yield { t: 0, kind: "scene", ...piece.cue.args };
          }
        }
      };

      const request = engineRequest(ctx, scenario, chat, beat);
      const t0 = performance.now();
      let modelDoneMs: number | undefined;
      let failed = false;
      const stream = eager(
        ctx.llm.complete({
          system: c1System(request.persona),
          messages: [{ role: "user", content: turnText(request) }],
          stream: true,
          model,
          maxTokens: 400,
          key: chat.id,
        }),
        () => {
          modelDoneMs = performance.now() - t0;
        },
      );
      try {
        for await (const chunk of stream) {
          if (chunk.type === "text") {
            for (const event of events(parser.push(chunk.text))) {
              if (event.kind === "say" && lines === 1) firstLineMs = performance.now() - t0;
              yield event;
            }
          } else if (chunk.type === "usage") addUsage(usage, chunk);
        }
      } catch (error) {
        failed = true;
        usage.controlErrors += 1;
        ctx.log(`C1: turn ${chat.id} transport failed (${error instanceof Error ? error.message : String(error)}).`);
      }
      yield* events(parser.end());
      if (firstLineMs !== undefined && modelDoneMs !== undefined) {
        ctx.log(`C1: ${chat.id} first line out at +${Math.round(firstLineMs)} ms, model finished at +${Math.round(modelDoneMs)} ms.`);
      }
      // The contract's emotion event has no intensity yet; the parsed value is validated and dropped.
      if (intensityDropped > 0) ctx.log(`C1: ${chat.id} intensity on ${intensityDropped} emotion tag(s) not carried (contract has no field).`);
      // A failed transport was counted above: one error per failed turn.
      if (lines === 0 && !failed) {
        usage.controlErrors += 1;
        ctx.log(`C1: turn ${chat.id} produced no spoken line.`);
      }
    },
    usage: () => ({ ...usage }),
  };
  return arm;
};
