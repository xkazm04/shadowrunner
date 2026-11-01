import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  createPlaneStore,
  DEFAULT_PLANE,
  fetchHealth,
  HEALTH_URL,
  parseHealth,
  planeOverride,
  resolvePlane,
  type Fetcher,
  type Health,
} from "./plane";

const planeArb = fc.constantFrom("replay" as const, "live" as const);
const healthArb: fc.Arbitrary<Health> = fc.record({
  plane: planeArb,
  engine: fc.constantFrom("scripted" as const, "anthropic" as const, "offline" as const),
  version: fc.string(),
});

describe("planeOverride", () => {
  it("forces replay on ?plane=replay, also among other parameters", () => {
    expect(planeOverride("?plane=replay")).toBe("replay");
    expect(planeOverride("?forge=fail:quota&plane=replay")).toBe("replay");
    expect(planeOverride("?plane=%20Replay%20")).toBe("replay");
  });

  it("never forces live: the replay plane cannot be talked out of the URL", () => {
    expect(planeOverride("?plane=live")).toBeUndefined();
    fc.assert(
      fc.property(fc.string(), (value) => {
        const expected = value.trim().toLowerCase() === "replay" ? "replay" : undefined;
        return planeOverride(`?${new URLSearchParams({ plane: value })}`) === expected;
      }),
    );
  });

  it("is absent without a plane parameter", () => {
    expect(planeOverride("")).toBeUndefined();
    expect(planeOverride("?theme=baseline")).toBeUndefined();
  });
});

describe("resolvePlane", () => {
  it("lets the override win over any health, then health, then the replay default", () => {
    fc.assert(
      fc.property(fc.option(fc.constant("replay" as const), { nil: undefined }), fc.option(healthArb, { nil: undefined }), (override, health) => {
        const expected = override ?? health?.plane ?? "replay";
        return resolvePlane(override, health) === expected;
      }),
    );
    expect(DEFAULT_PLANE).toBe("replay");
  });
});

describe("parseHealth", () => {
  it("accepts every well-formed body and keeps only the three fields", () => {
    fc.assert(
      fc.property(healthArb, fc.dictionary(fc.string(), fc.jsonValue()), (health, extra) => {
        expect(parseHealth({ ...extra, ...health })).toEqual(health);
      }),
    );
  });

  it("rejects a body with any field missing or of the wrong kind", () => {
    const field = fc.constantFrom("plane", "engine", "version");
    const bad = fc.oneof(fc.constant(undefined), fc.integer(), fc.constant("unknown"), fc.constant(null));
    fc.assert(
      fc.property(healthArb, field, bad, (health, key, value) => {
        if (key === "version" && typeof value === "string") return;
        expect(parseHealth({ ...health, [key]: value })).toBeUndefined();
      }),
    );
    for (const body of [null, "ok", 3, [], { ok: true }]) expect(parseHealth(body)).toBeUndefined();
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
}

describe("fetchHealth", () => {
  const good: Health = { plane: "live", engine: "anthropic", version: "abc1234" };

  it("asks /api/health and returns the parsed body", async () => {
    const fetcher = vi.fn<Fetcher>(async () => jsonResponse(good));
    expect(await fetchHealth(fetcher)).toEqual(good);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(HEALTH_URL);
  });

  it("returns undefined, never throws, when health cannot be read", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => jsonResponse(good, { status: 503 }),
      async () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } }),
      async () => jsonResponse({ plane: "staging", engine: "scripted", version: "x" }),
      async () => {
        throw new TypeError("network down");
      },
    ];
    for (const answer of answers) expect(await fetchHealth(answer)).toBeUndefined();
  });
});

describe("createPlaneStore", () => {
  it("loads once, on first subscribe, and notifies every subscriber", async () => {
    const health: Health = { plane: "live", engine: "scripted", version: "dev" };
    let settle: (h: Health | undefined) => void = () => undefined;
    const load = vi.fn(() => new Promise<Health | undefined>((resolve) => (settle = resolve)));
    const store = createPlaneStore(load);
    expect(load).not.toHaveBeenCalled();

    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);
    offA();
    store.subscribe(a);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.health()).toBeUndefined();

    settle(health);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.health()).toEqual(health);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stays on no health when the loader rejects", async () => {
    const store = createPlaneStore(() => Promise.reject(new Error("boom")));
    const onChange = vi.fn();
    store.subscribe(onChange);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.health()).toBeUndefined();
  });
});
