// POST /api/engine/reply (voice-and-air requirement 2) with a fake fetch and a memory quota.
import { describe, expect, it } from "vitest";
import type { ChatMsg, EngineRequest, FetchLike } from "@sr/engine";
import { handleReply, type ReplyDeps } from "../engine/reply.js";
import { createQuota, DEFAULT_LIMITS, MemoryQuotaStore, type QuotaKind } from "../_lib/quota.js";
import { replayShow } from "../_lib/show.js";

const LIVE = { SR_PLANE: "live", ANTHROPIC_API_KEY: "sk-test-not-real" };

interface Recorder {
  fetch: FetchLike;
  bodies: Record<string, unknown>[];
}

function recordingFetch(text = '{"line":"Your petition is filed.","emotion":"bored"}'): Recorder {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const body = JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  };
  return { fetch, bodies };
}

const throwingFetch: FetchLike = () => {
  throw new Error("network must not be touched on replay");
};

function memoryQuota(perIp: Partial<Record<QuotaKind, number>> = {}) {
  const charges: QuotaKind[] = [];
  const inner = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { ...DEFAULT_LIMITS, perIp: { ...DEFAULT_LIMITS.perIp, ...perIp } } });
  return {
    charges,
    quota: {
      checkAndCharge: (ip: string, kind: QuotaKind, usd: number) => {
        charges.push(kind);
        return inner.checkAndCharge(ip, kind, usd);
      },
    },
  };
}

function body(chat: ChatMsg[] = [], extra: Partial<EngineRequest> = {}): EngineRequest {
  return {
    characterId: "malakor",
    persona: { characterId: "malakor", name: "Malakor", bible: "the bible", voice: "clerk" },
    chat,
    beat: 0,
    ...extra,
  };
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://sr.test/api/engine/reply", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function deps(env: Record<string, string>, fetch: FetchLike, quota = memoryQuota().quota): ReplyDeps {
  return { env, fetch, quota };
}

describe("POST /api/engine/reply on replay", () => {
  it("answers from the recorded show with zero fetches and no quota charge", async () => {
    const q = memoryQuota();
    const res = await handleReply(post(body([], { beat: 2 })), deps({}, throwingFetch, q.quota));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(replayShow().beats[2]?.reply);
    expect(q.charges).toEqual([]);
  });

  it("serves replay when x-sr-plane: replay is sent, even on a live deploy with a key", async () => {
    const q = memoryQuota();
    const res = await handleReply(post(body(), { "x-sr-plane": "replay" }), deps(LIVE, throwingFetch, q.quota));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(replayShow().beats[0]?.reply);
    expect(q.charges).toEqual([]);
  });

  it("rejects a malformed body with bad_input", async () => {
    for (const bad of ["{", "[]", JSON.stringify({ ...body(), beat: "x" }), JSON.stringify({ ...body(), persona: { ...body().persona, voice: "opera" } })]) {
      const res = await handleReply(post(bad), deps({}, throwingFetch));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "bad_input" } });
    }
  });
});

describe("POST /api/engine/reply on live", () => {
  it("charges quota kind engine before the call, then answers", async () => {
    const q = memoryQuota();
    const rec = recordingFetch();
    const res = await handleReply(post(body()), deps(LIVE, rec.fetch, q.quota));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ line: "Your petition is filed.", emotion: "bored" });
    expect(q.charges).toEqual(["engine"]);
    expect(rec.bodies).toHaveLength(1);
  });

  it("fails with quota before any call when the quota is exhausted", async () => {
    const q = memoryQuota({ engine: 0 });
    const rec = recordingFetch();
    const res = await handleReply(post(body()), deps(LIVE, rec.fetch, q.quota));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "quota" } });
    expect(rec.bodies).toHaveLength(0);
  });

  it("cuts the chat to the last 20 messages of at most 300 characters instead of rejecting it", async () => {
    const chat: ChatMsg[] = Array.from({ length: 35 }, (_, i) => ({ id: `c${i}`, user: `u${i}`, text: "x".repeat(1000), ts: i }));
    chat[0] = { id: "c0", user: "u0", text: "", ts: Number.NaN }; // old and invalid, cut before validation
    const rec = recordingFetch();
    const payload = JSON.stringify(body(chat)).replace('"ts":null', '"ts":"bad"');
    const res = await handleReply(post(payload), deps(LIVE, rec.fetch));
    expect(res.status).toBe(200);
    const messages = rec.bodies[0]?.messages;
    const content = Array.isArray(messages) ? String(messages[0]?.content) : "";
    const lines = content.split("</chat>")[0]?.split("\n").filter((l) => l.startsWith("{")) ?? [];
    expect(lines).toHaveLength(20);
    for (const line of lines) expect(JSON.parse(line).text).toHaveLength(300);
    expect(JSON.parse(lines[0] ?? "{}").id).toBe("c15");
  });

  it("maps an engine failure to upstream without leaking upstream text, and reports offline without a key", async () => {
    const bad: FetchLike = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("secret upstream body") });
    const res = await handleReply(post(body()), deps(LIVE, bad));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('"upstream"');
    expect(text).not.toContain("secret upstream body");
    const offline = await handleReply(post(body()), deps({ SR_PLANE: "live" }, throwingFetch));
    expect(await offline.json()).toMatchObject({ error: { code: "upstream" } });
  });
});
