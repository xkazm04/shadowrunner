import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMOTIONS, EngineError, GESTURES, MAX_LINE_CHARS, parseReply, REPLY_SCHEMA, trimLine } from "@sr/engine";

/** Text made of words and sentence ends, so boundaries are common. */
const proseArb = fc
  .array(fc.oneof({ weight: 4, arbitrary: fc.constantFrom("lich", "ledger", "crown", "Ninth", "a") }, { weight: 1, arbitrary: fc.string({ maxLength: 12 }) }), {
    minLength: 20,
    maxLength: 120,
  })
  .chain((words) =>
    fc.array(fc.constantFrom(" ", " ", ". ", "! ", "? ", ", ", "... ", ".\" "), { minLength: words.length, maxLength: words.length }).map((seps) =>
      words.map((w, i) => w + (seps[i] ?? " ")).join(""),
    ),
  );

const SENTENCE_END_AT_END = /[.!?…]["'’”)\]]*$/;

/** Walks a JSON schema and yields every object node. */
function* objectNodes(node: unknown): Generator<Record<string, unknown>> {
  if (typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* objectNodes(n);
    return;
  }
  const rec: Record<string, unknown> = { ...node };
  if (rec.type === "object") yield rec;
  for (const v of Object.values(rec)) yield* objectNodes(v);
}

describe("REPLY_SCHEMA", () => {
  it("has additionalProperties: false on every object and no min/max/length constraints", () => {
    const objects = [...objectNodes(REPLY_SCHEMA)];
    expect(objects.length).toBeGreaterThan(0);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
    const text = JSON.stringify(REPLY_SCHEMA);
    expect(text).not.toMatch(/"(min|max)[A-Za-z]*"|"(exclusiveM(in|ax)imum|multipleOf|pattern)"/);
    expect(REPLY_SCHEMA.properties.line.description).toContain("250");
  });

  it("enumerates exactly the rig's emotions and gestures", () => {
    expect(REPLY_SCHEMA.properties.emotion.enum).toEqual([...EMOTIONS]);
    expect(REPLY_SCHEMA.properties.gesture.enum).toEqual([...GESTURES]);
  });
});

describe("trimLine", () => {
  it("is at most 250 characters and a prefix of the trimmed input", () => {
    fc.assert(
      fc.property(fc.oneof(proseArb, fc.string({ maxLength: 600 })), (text) => {
        const out = trimLine(text);
        expect(out.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
        expect(text.trim().startsWith(out)).toBe(true);
      }),
    );
  });

  it("leaves a line within the limit untouched (bar outer whitespace)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 250 }), (text) => {
        fc.pre(text.trim().length <= MAX_LINE_CHARS);
        expect(trimLine(text)).toBe(text.trim());
      }),
    );
  });

  it("cuts an over-long line at the last sentence boundary within 250 when there is one", () => {
    fc.assert(
      fc.property(proseArb, (text) => {
        const clean = text.trim();
        fc.pre(clean.length > MAX_LINE_CHARS);
        const head = clean.slice(0, MAX_LINE_CHARS + 1);
        const boundaries = [...head.matchAll(/[.!?…]["'’”)\]]*(?=\s)/g)]
          .map((m) => m.index + m[0].length)
          .filter((end) => end <= MAX_LINE_CHARS);
        const last = boundaries.at(-1);
        fc.pre(last !== undefined && last > 0);
        const out = trimLine(text);
        expect(out).toMatch(SENTENCE_END_AT_END);
        expect(out).toBe(clean.slice(0, last).trimEnd());
      }),
    );
  });

  it("matches a worked example", () => {
    const text = `${"The ledger is closed. ".repeat(11)}And this sentence runs far past the limit of two hundred and fifty characters.`;
    expect(trimLine(text)).toBe("The ledger is closed. ".repeat(11).trimEnd());
  });
});

describe("parseReply", () => {
  it("never throws on arbitrary text except with EngineError('upstream')", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v))), (text) => {
        try {
          const reply = parseReply(text);
          expect(reply.line.length).toBeGreaterThan(0);
          expect(reply.line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
          expect(EMOTIONS).toContain(reply.emotion);
        } catch (err) {
          expect(err).toBeInstanceOf(EngineError);
          expect(err instanceof EngineError && err.code).toBe("upstream");
        }
      }),
    );
  });

  it("keeps a valid reply, maps an unknown emotion to neutral and drops an unknown gesture", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), fc.string(), fc.string(), (line, emotion, gesture) => {
        fc.pre(line.trim().length > 0);
        const reply = parseReply(JSON.stringify({ line, emotion, gesture }));
        expect(reply.line).toBe(line.trim());
        expect(reply.emotion).toBe((EMOTIONS as readonly string[]).includes(emotion) ? emotion : "neutral");
        if ((GESTURES as readonly string[]).includes(gesture)) expect(reply.gesture).toBe(gesture);
        else expect("gesture" in reply).toBe(false);
      }),
    );
  });

  it("raises upstream on malformed replies", () => {
    for (const bad of ["", "nope", "[]", "null", "{}", '{"line":3}', '{"line":"   "}']) {
      expect(() => parseReply(bad)).toThrow(EngineError);
    }
    expect(parseReply('{"line":"Hail.","emotion":"grim","gesture":"nod","answeredId":"c1"}')).toEqual({
      line: "Hail.",
      emotion: "grim",
      gesture: "nod",
      answeredId: "c1",
    });
  });
});
