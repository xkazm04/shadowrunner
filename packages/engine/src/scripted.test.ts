import fc from "fast-check";
import { describe, expect, it } from "vitest";
import showJson from "../../../assets/replay/shows/malakor-night.json";
import {
  beatIndex,
  parseShow,
  parseShowJson,
  ScriptedEngine,
  scriptedReply,
  type ChatMsg,
  type EngineRequest,
  type Persona,
  type ShowScript,
} from "@sr/engine";

function loadShow(): ShowScript {
  const show = parseShow(showJson);
  if (show === undefined) throw new Error("malakor-night.json does not validate");
  return show;
}

const SHOW = loadShow();

const PERSONA: Persona = { characterId: "malakor", name: "Malakor", bible: "(bible)", voice: "clerk" };

const chatArb: fc.Arbitrary<ChatMsg[]> = fc
  .array(
    fc.record({ user: fc.string({ maxLength: 8 }), text: fc.string({ maxLength: 30 }), ts: fc.nat(), visitor: fc.boolean() }),
    { maxLength: 12 },
  )
  .map((rows) =>
    rows.map(({ user, text, ts, visitor }, i) => (visitor ? { id: `c${i}`, user, text, ts, fromVisitor: true } : { id: `c${i}`, user, text, ts })),
  );

const reqArb: fc.Arbitrary<EngineRequest> = fc
  .record({
    chat: chatArb,
    beat: fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.double()),
    seed: fc.option(fc.integer({ min: -1_000_000, max: 1_000_000 }), { nil: undefined }),
    pick: fc.nat(),
    picks: fc.boolean(),
  })
  .map(({ chat, beat, seed, pick, picks }) => {
    const chosen = picks && chat.length > 0 ? chat[pick % chat.length] : undefined;
    return {
      characterId: "malakor",
      persona: PERSONA,
      chat,
      beat,
      ...(seed === undefined ? {} : { seed }),
      ...(chosen === undefined ? {} : { pickedId: chosen.id }),
    };
  });

describe("malakor-night.json", () => {
  it("validates, with ~40 fictional audience messages and ~24 beats", () => {
    expect(SHOW.fictional).toBe(true);
    expect(SHOW.audience.length).toBeGreaterThanOrEqual(36);
    expect(SHOW.beats.length).toBeGreaterThanOrEqual(20);
    expect(SHOW.audience.every((m) => m.fictional === true)).toBe(true);
  });

  it("answers each message after it was posted, by its own id, within 250 characters", () => {
    const byId = new Map(SHOW.audience.map((m) => [m.id, m]));
    for (const beat of SHOW.beats) {
      expect(beat.reply.line.length).toBeLessThanOrEqual(250);
      if (beat.replyTo === undefined) {
        expect(beat.reply.answeredId).toBeUndefined();
        continue;
      }
      expect(beat.reply.answeredId).toBe(beat.replyTo);
      expect(byId.get(beat.replyTo)?.ts).toBeLessThan(beat.at);
    }
  });

  it("names one WAV per beat under malakor-night/, and has generic beats for visitors", () => {
    const wavs = SHOW.beats.map((b) => b.wav);
    expect(new Set(wavs).size).toBe(wavs.length);
    for (const wav of wavs) expect(wav).toMatch(/^malakor-night\/[a-z0-9-]+\.wav$/);
    expect(SHOW.beats.filter((b) => b.replyTo === undefined).length).toBeGreaterThanOrEqual(4);
  });

  it("never posts as the character", () => {
    expect(SHOW.audience.some((m) => m.user.toLowerCase() === "malakor")).toBe(false);
  });
});

describe("ScriptedEngine", () => {
  it("is deterministic per (seed, beat): equal requests get equal replies across calls and instances", async () => {
    await fc.assert(
      fc.asyncProperty(reqArb, async (req) => {
        const a = new ScriptedEngine(SHOW);
        const b = new ScriptedEngine(SHOW);
        const first = await a.reply(req);
        await a.reply({ ...req, beat: 7 }); // a call in between must not change the next answer
        expect(await a.reply(req)).toEqual(first);
        expect(await b.reply({ ...req, chat: req.chat.map((m) => ({ ...m })) })).toEqual(first);
        expect(scriptedReply(SHOW, req)).toEqual(first);
      }),
    );
  });

  it("serves beats[(beat + seed) mod n] when no visitor is picked", () => {
    fc.assert(
      fc.property(reqArb, (req) => {
        const picked = req.chat.find((m) => m.id === req.pickedId);
        fc.pre(!picked?.fromVisitor);
        const n = SHOW.beats.length;
        const b = Number.isFinite(req.beat) ? Math.trunc(req.beat) : 0;
        const index = (((b + (req.seed ?? 0)) % n) + n) % n; // independent oracle
        expect(beatIndex(SHOW, req.beat, req.seed)).toBe(index);
        expect(scriptedReply(SHOW, req)).toEqual(SHOW.beats[index]?.reply);
      }),
    );
  });

  it("answers a picked visitor with a generic line addressed to that message", () => {
    fc.assert(
      fc.property(reqArb, (req) => {
        const picked = req.chat.find((m) => m.id === req.pickedId);
        fc.pre(picked?.fromVisitor === true);
        const reply = scriptedReply(SHOW, req);
        const generic = SHOW.beats.filter((b) => b.replyTo === undefined).map((b) => b.reply.line);
        expect(generic).toContain(reply.line);
        expect(reply.answeredId).toBe(req.pickedId);
      }),
    );
  });

  it("walks the whole show in order from beat 0 and wraps", async () => {
    const engine = new ScriptedEngine(SHOW);
    const n = SHOW.beats.length;
    for (let b = 0; b < n * 2; b += 1) {
      const reply = await engine.reply({ characterId: "malakor", persona: PERSONA, chat: [], beat: b });
      expect(reply).toEqual(SHOW.beats[b % n]?.reply);
    }
    expect(engine.kind).toBe("scripted");
  });

  it("returns a copy, so a caller cannot edit the show", async () => {
    const engine = new ScriptedEngine(SHOW);
    const req: EngineRequest = { characterId: "malakor", persona: PERSONA, chat: [], beat: 0 };
    const reply = await engine.reply(req);
    reply.line = "edited";
    expect((await engine.reply(req)).line).not.toBe("edited");
  });
});

describe("parseShowJson", () => {
  it("rejects malformed text, a show without generic beats and a dangling replyTo", () => {
    expect(parseShowJson("{")).toBeUndefined();
    const noGeneric = { ...SHOW, beats: SHOW.beats.filter((b) => b.replyTo !== undefined) };
    expect(parseShowJson(JSON.stringify(noGeneric))).toBeUndefined();
    const dangling = { ...SHOW, beats: [...SHOW.beats, { at: 1, replyTo: "nope", reply: { line: "x", emotion: "grim" }, wav: "x.wav" }] };
    expect(parseShowJson(JSON.stringify(dangling))).toBeUndefined();
    const badEmotion = { ...SHOW, beats: [{ at: 0, reply: { line: "x", emotion: "sad" }, wav: "x.wav" }] };
    expect(parseShowJson(JSON.stringify(badEmotion))).toBeUndefined();
  });
});
