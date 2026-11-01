// Upstash REST KV client with an injected fetch (request shape and error hygiene only; no network).
import { describe, expect, it } from "vitest";
import { isDeployed, kvFromEnv, upstashKv, type FetchLike } from "../_lib/kv.js";

const TOKEN = "kv-token-SECRET";

function fake(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return typeof reply === "string" ? new Response(reply, { status }) : Response.json(reply, { status });
  };
  return { f, calls };
}

describe("upstashKv", () => {
  it("sends GET/SET as command arrays with a bearer token", async () => {
    const get = fake({ result: "v" });
    const kv = upstashKv({ url: "https://kv.example/", token: TOKEN, fetch: get.f });
    expect(await kv.get("job:abc")).toBe("v");
    expect(get.calls[0]?.url).toBe("https://kv.example");
    expect(String(get.calls[0]?.init.body)).toBe('["GET","job:abc"]');
    expect(new Headers(get.calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);

    const set = fake({ result: "OK" });
    await upstashKv({ url: "https://kv.example", token: TOKEN, fetch: set.f }).set("k", "v", 60);
    expect(String(set.calls[0]?.init.body)).toBe('["SET","k","v","EX","60"]');
  });

  it("incrBy runs INCRBY and EXPIRE in one transaction", async () => {
    const t = fake([{ result: 4 }, { result: 1 }]);
    expect(await upstashKv({ url: "https://kv.example", token: TOKEN, fetch: t.f }).incrBy("q", 2, 99)).toBe(4);
    expect(t.calls[0]?.url).toBe("https://kv.example/multi-exec");
    expect(String(t.calls[0]?.init.body)).toBe('[["INCRBY","q","2"],["EXPIRE","q","99"]]');
  });

  it.each([
    ["HTTP 500", fake(`{"error":"${TOKEN}"}`, 500)],
    ["error reply", fake({ error: "WRONGTYPE" })],
    ["not JSON", fake("<html>")],
    ["wrong value type", fake({ result: 5 })],
  ])("%s becomes a generic upstream ApiError", async (_label, t) => {
    const err = await upstashKv({ url: "https://kv.example", token: TOKEN, fetch: t.f }).get("k").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "upstream", message: "Storage is unavailable." });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });
});

describe("kvFromEnv / isDeployed", () => {
  it("is undefined without a URL and refuses a URL without token or https", () => {
    expect(kvFromEnv({})).toBeUndefined();
    expect(() => kvFromEnv({ KV_REST_API_URL: "https://kv.example" })).toThrow("Storage is not configured.");
    expect(() => kvFromEnv({ KV_REST_API_URL: "http://kv.example", KV_REST_API_TOKEN: TOKEN })).toThrow("Storage is not configured.");
    expect(kvFromEnv({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: TOKEN })).toBeDefined();
  });

  it("only production and preview count as deployed", () => {
    expect([isDeployed({ VERCEL_ENV: "production" }), isDeployed({ VERCEL_ENV: "preview" }), isDeployed({ VERCEL_ENV: "development" }), isDeployed({})]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
