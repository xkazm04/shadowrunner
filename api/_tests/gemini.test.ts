// Gemini client with an injected fetch: no test reaches the network (forge-pipeline task 6.1).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS, GeminiError, createGemini, geminiFromEnv, geminiModels, type FetchLike } from "../_lib/gemini.js";

const KEY = "test-key-SECRET-do-not-leak";
const PNG = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const imageReply = (b64 = "AAEC") =>
  Response.json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/jpeg", data: b64 } }] } }] });
const textReply = (parts: object[]) => Response.json({ candidates: [{ content: { parts } }] });

function bodyOf(call: Call | undefined): Record<string, unknown> {
  // Test-side parse of our own serialized request, not external data.
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("geminiModels", () => {
  it("uses the .env.example defaults when nothing is set", () => {
    expect(geminiModels({})).toEqual(DEFAULT_MODELS);
    expect(DEFAULT_MODELS).toEqual({ image: "gemini-3-pro-image", imageDraft: "gemini-3.1-flash-image", segment: "gemini-3.8-flash" });
  });

  it("reads SR_IMAGE_MODEL, SR_IMAGE_DRAFT_MODEL and SR_SEGMENT_MODEL, ignoring blanks", () => {
    expect(geminiModels({ SR_IMAGE_MODEL: " a ", SR_IMAGE_DRAFT_MODEL: "b", SR_SEGMENT_MODEL: "  " })).toEqual({
      image: "a",
      imageDraft: "b",
      segment: DEFAULT_MODELS.segment,
    });
  });
});

describe("createGemini", () => {
  it("generateImage posts the prompt to the final model with the key only in a header", async () => {
    const f = fakeFetch(() => imageReply());
    const gemini = createGemini({ apiKey: KEY, fetch: f.fetch });
    const img = await gemini.generateImage("a lich");
    expect(img).toEqual({ mimeType: "image/jpeg", data: new Uint8Array([0, 1, 2]) });
    const [call] = f.calls;
    expect(call?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent");
    expect(call?.url).not.toContain(KEY);
    expect(new Headers(call?.init.headers).get("x-goog-api-key")).toBe(KEY);
    expect(bodyOf(call)).toEqual({
      contents: [{ role: "user", parts: [{ text: "a lich" }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
    });
  });

  it("draft images use the draft model; models come from env through geminiFromEnv", async () => {
    const f = fakeFetch(() => imageReply());
    const gemini = geminiFromEnv({ GEMINI_API_KEY: KEY, SR_IMAGE_DRAFT_MODEL: "draft-x", SR_IMAGE_MODEL: "final-y" }, f.fetch);
    await gemini.generateImage("p", { draft: true });
    await gemini.editImage(PNG, "restyle");
    expect(f.calls.map((c) => c.url.split("/").pop())).toEqual(["draft-x:generateContent", "final-y:generateContent"]);
    const parts = (bodyOf(f.calls[1]).contents as { parts: unknown[] }[])[0]?.parts;
    expect(parts).toEqual([{ inlineData: { mimeType: "image/png", data: "iVBORw==" } }, { text: "restyle" }]);
  });

  it("generateJson asks for application/json and returns the answer text without thought parts", async () => {
    const f = fakeFetch(() => textReply([{ text: "thinking...", thought: true }, { text: "[{" }, { text: "}]" }]));
    const gemini = createGemini({ apiKey: KEY, fetch: f.fetch });
    expect(await gemini.generateJson("parts?", PNG)).toBe("[{}]");
    expect(f.calls[0]?.url).toContain("/gemini-3.8-flash:generateContent");
    expect(bodyOf(f.calls[0]).generationConfig).toEqual({ responseMimeType: "application/json" });
  });

  it("refuses without a key and never calls fetch", async () => {
    const f = fakeFetch(() => imageReply());
    const gemini = createGemini({ apiKey: "  ", fetch: f.fetch });
    await expect(gemini.generateImage("x")).rejects.toMatchObject({ code: "upstream", reason: "no_key" });
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    [429, "rate_limited"],
    [500, "http"],
    [400, "http"],
  ])("HTTP %i becomes upstream/%s without the upstream body", async (status, reason) => {
    const f = fakeFetch(() => new Response(`{"error":{"message":"API key ${KEY} invalid"}}`, { status }));
    const gemini = createGemini({ apiKey: KEY, fetch: f.fetch });
    const err = await gemini.generateImage("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err).toMatchObject({ code: "upstream", reason, status: 502, httpStatus: status });
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String((err as Error).message)).not.toMatch(/key|invalid/i);
  });

  it("times out with reason timeout", async () => {
    const f = fakeFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const gemini = createGemini({ apiKey: KEY, fetch: f.fetch, timeoutMs: 20 });
    await expect(gemini.generateImage("x")).rejects.toMatchObject({ reason: "timeout" });
    await expect(gemini.generateJson("x", undefined, { timeoutMs: 10 })).rejects.toMatchObject({ reason: "timeout" });
  });

  it("network failures become reason network, without the error text", async () => {
    const f = fakeFetch(() => Promise.reject(new Error(`connect ECONNREFUSED ${KEY}`)));
    const err = await createGemini({ apiKey: KEY, fetch: f.fetch }).generateImage("x").catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: "network" });
    expect((err as Error).message).not.toContain(KEY);
  });

  it.each([
    ["blocked prompt", { promptFeedback: { blockReason: "SAFETY" } }, "blocked"],
    ["blocked output", { candidates: [{ finishReason: "IMAGE_SAFETY" }] }, "blocked"],
    ["no candidates", { candidates: [] }, "malformed"],
    ["not an object", [1, 2], "malformed"],
    ["text only", { candidates: [{ content: { parts: [{ text: "sorry" }] } }] }, "no_image"],
  ])("%s -> %s", async (_label, reply, reason) => {
    const f = fakeFetch(() => Response.json(reply));
    await expect(createGemini({ apiKey: KEY, fetch: f.fetch }).generateImage("x")).rejects.toMatchObject({ reason });
  });

  it("a 2xx body that is not JSON is malformed; empty JSON text is no_text", async () => {
    const bad = fakeFetch(() => new Response("<html>", { status: 200 }));
    await expect(createGemini({ apiKey: KEY, fetch: bad.fetch }).generateJson("x")).rejects.toMatchObject({ reason: "malformed" });
    const empty = fakeFetch(() => textReply([{ text: "  " }]));
    await expect(createGemini({ apiKey: KEY, fetch: empty.fetch }).generateJson("x")).rejects.toMatchObject({ reason: "no_text" });
  });

  it("never logs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const f = fakeFetch(() => new Response("nope", { status: 500 }));
    await createGemini({ apiKey: KEY, fetch: f.fetch }).generateImage("x").catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
