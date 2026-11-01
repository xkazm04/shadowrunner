import { PLANE_HEADER } from "@sr/engine";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  createPlaneStore,
  DEFAULT_PLANE,
  fetchHealth,
  HEALTH_URL,
  isApiPath,
  planeOverride,
  resolvePlane,
  withPlaneHeader,
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

// parseHealth moved to its owner, @sr/engine (packages/engine/src/validate.test.ts).

describe("withPlaneHeader", () => {
  const apiPath = fc.webPath().map((p) => `/api/${p.replace(/^\/+/, "")}`);
  const otherUrl = fc.oneof(
    fc.constantFrom("/", "/air", "/apix", "/api", "https://sr.test/api/health", "//cdn.test/api/x"),
    fc.webUrl(),
  );
  const callerHeaders = fc.dictionary(
    fc.constantFrom("accept", "content-type", PLANE_HEADER, "x-trace"),
    fc.constantFrom("application/json", "live", "replay", "1"),
  );

  /** A fetcher that records the headers it was handed. */
  function recording() {
    const seen: Headers[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      seen.push(new Headers(init?.headers));
      return new Response(null, { status: 204 });
    };
    return { seen, fetcher };
  }

  it("tags every /api/* request with x-sr-plane: replay while ?plane=replay is active", async () => {
    await fc.assert(
      fc.asyncProperty(apiPath, callerHeaders, async (url, headers) => {
        const { seen, fetcher } = recording();
        await withPlaneHeader(fetcher, () => "?theme=baseline&plane=Replay")(url, { headers });
        expect(seen[0]?.get(PLANE_HEADER)).toBe("replay");
        for (const [name, value] of Object.entries(headers)) {
          if (name !== PLANE_HEADER) expect(seen[0]?.get(name)).toBe(value);
        }
      }),
    );
  });

  it("leaves requests alone without the override, and non-API URLs alone with it", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(apiPath, otherUrl), callerHeaders, fc.boolean(), async (url, headers, active) => {
        if (active && isApiPath(url)) return;
        const { seen, fetcher } = recording();
        const search = active ? "?plane=replay" : "?plane=live";
        await withPlaneHeader(fetcher, () => search)(url, { headers });
        expect(seen[0]?.get(PLANE_HEADER) ?? undefined).toBe(headers[PLANE_HEADER]);
      }),
    );
  });

  it("reads the URL per request, so the header follows the override", async () => {
    let search = "?plane=replay";
    const { seen, fetcher } = recording();
    const tagged = withPlaneHeader(fetcher, () => search);
    await tagged(HEALTH_URL);
    search = "";
    await tagged(HEALTH_URL);
    expect(seen.map((h) => h.get(PLANE_HEADER))).toEqual(["replay", null]);
  });

  it("is what the health read goes through", async () => {
    const { seen, fetcher } = recording();
    await fetchHealth(withPlaneHeader(fetcher, () => "?plane=replay"));
    expect(seen[0]?.get(PLANE_HEADER)).toBe("replay");
    expect(seen[0]?.get("accept")).toBe("application/json");
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
