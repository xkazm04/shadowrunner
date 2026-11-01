import { describe, expectTypeOf, it } from "vitest";
import type { Emotion, Gesture } from "@sr/rig";
import type { ChatMsg, Engine, EngineReply, EngineRequest, Persona, VoiceId } from "@sr/engine";

// Compile-time checks: `pnpm typecheck` fails if the wire contract drifts from design.md.
describe("engine wire contract (design.md, Contracts)", () => {
  it("EngineReply uses Emotion and Gesture from @sr/rig", () => {
    expectTypeOf<EngineReply>().toEqualTypeOf<{
      line: string;
      emotion: Emotion;
      gesture?: Gesture;
      answeredId?: string;
    }>();
  });

  it("Engine has a kind and a reply method", () => {
    expectTypeOf<Engine["kind"]>().toEqualTypeOf<"scripted" | "anthropic">();
    expectTypeOf<Engine["reply"]>().toEqualTypeOf<(req: EngineRequest) => Promise<EngineReply>>();
  });

  it("ChatMsg, Persona and EngineRequest match field for field", () => {
    expectTypeOf<ChatMsg>().toEqualTypeOf<{
      id: string;
      user: string;
      text: string;
      ts: number;
      fictional?: true;
      fromVisitor?: true;
    }>();
    expectTypeOf<Persona>().toEqualTypeOf<{ characterId: string; name: string; bible: string; voice: VoiceId }>();
    expectTypeOf<EngineRequest>().toEqualTypeOf<{
      characterId: string;
      persona: Persona;
      chat: ChatMsg[];
      pickedId?: string;
      beat: number;
      seed?: number;
    }>();
  });
});
