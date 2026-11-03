// Shared quota (requirement 7.3): per-IP daily count and global daily USD cap, memory backend only.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_USD } from "../_lib/costs.js";
import {
  CLOSED_QUOTA,
  DEFAULT_LIMITS,
  MemoryQuotaStore,
  checkAndCharge,
  clientIp,
  createQuota,
  hashIp,
  quotaFromEnv,
  quotaLimits,
  setSharedQuota,
  type QuotaKind,
  type QuotaLimits,
  type QuotaStore,
} from "../_lib/quota.js";

const DAY = new Date("2026-11-01T12:00:00Z");
const kinds = fc.constantFrom<QuotaKind>("forge", "engine", "voice");

function quota(limits: QuotaLimits, now: () => Date = () => DAY) {
  const store = new MemoryQuotaStore(() => now().getTime());
  return { store, q: createQuota({ store, salt: "salt", limits, now }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  setSharedQuota(undefined);
});

describe("per-IP daily count", () => {
  it("lets exactly the limit through per IP and kind, independent across IPs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), kinds, fc.array(fc.constantFrom("1.1.1.1", "2.2.2.2", "::1"), { maxLength: 25 }), async (limit, kind, ips) => {
        const { q } = quota({ perIp: { forge: limit, engine: limit, voice: limit }, dailyUsd: 1000 });
        const accepted = new Map<string, number>();
        for (const ip of ips) {
          const r = await q.checkAndCharge(ip, kind, 0);
          if (r.ok) accepted.set(ip, (accepted.get(ip) ?? 0) + 1);
          else expect(r).toEqual({ ok: false, code: "quota" });
        }
        for (const ip of new Set(ips)) {
          expect(accepted.get(ip) ?? 0).toBe(Math.min(limit, ips.filter((x) => x === ip).length));
        }
      }),
    );
  });

  it("count: false charges USD without using up the per-IP count", async () => {
    const { q } = quota({ perIp: { forge: 1, engine: 1, voice: 1 }, dailyUsd: 1000 });
    expect(await q.checkAndCharge("ip", "forge", 0.1)).toEqual({ ok: true });
    for (let i = 0; i < 5; i += 1) expect(await q.checkAndCharge("ip", "forge", 0.1, { count: false })).toEqual({ ok: true });
    expect(await q.checkAndCharge("ip", "forge", 0.1)).toEqual({ ok: false, code: "quota" });
  });

  it("kinds count separately and the count resets on the next UTC day", async () => {
    let now = DAY;
    const { q } = quota({ perIp: { forge: 1, engine: 1, voice: 1 }, dailyUsd: 1000 }, () => now);
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(true);
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(false);
    expect((await q.checkAndCharge("ip", "voice", 0)).ok).toBe(true);
    now = new Date("2026-11-02T00:00:01Z");
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(true);
  });
});

describe("global daily USD cap", () => {
  it("accepts a charge iff the running total stays within the cap; refusals charge nothing", async () => {
    const cents = fc.integer({ min: 0, max: 300 });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 1000 }), fc.array(fc.tuple(fc.ipV4(), kinds, cents), { maxLength: 30 }), async (capCents, calls) => {
        const { q, store } = quota({ perIp: { forge: 1e9, engine: 1e9, voice: 1e9 }, dailyUsd: capCents / 100 });
        let spent = 0;
        for (const [ip, kind, c] of calls) {
          const r = await q.checkAndCharge(ip, kind, c / 100, { count: false });
          const fits = spent + c <= capCents;
          expect(r.ok).toBe(fits);
          if (fits) spent += c;
        }
        const usd = store.entries().find(([k]) => k.endsWith(":usd"))?.[1] ?? 0;
        expect(usd).toBe(spent * 10_000);
        expect(usd).toBeLessThanOrEqual(capCents * 10_000);
      }),
    );
  });

  it("a refusal over the USD cap gives back the per-IP use it counted", async () => {
    const { q } = quota({ perIp: { forge: 2, engine: 2, voice: 2 }, dailyUsd: 0.1 });
    expect((await q.checkAndCharge("ip", "forge", 1)).ok).toBe(false);
    expect((await q.checkAndCharge("ip", "forge", 0.05)).ok).toBe(true);
    expect((await q.checkAndCharge("ip", "forge", 0.05)).ok).toBe(true);
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(false);
  });

  it("the default cap of 30 USD holds a realistic forge mix (six expression edits each)", async () => {
    const { q } = quota(DEFAULT_LIMITS);
    let forges = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = await q.checkAndCharge(`10.0.0.${i}`, "forge", COST_USD.imageDraft + COST_USD.imageFinal + COST_USD.segment + COST_USD.imageEdit + 6 * COST_USD.expression);
      if (r.ok) forges += 1;
    }
    expect(forges).toBe(Math.floor(30 / 1.17));
  });
});

describe("safety", () => {
  it("stores the IP only as a salted hash", async () => {
    const { q, store } = quota(DEFAULT_LIMITS);
    await q.checkAndCharge("203.0.113.7", "engine", 0.003);
    const keys = store.entries().map(([k]) => k);
    expect(keys).toContain(`quota:2026-11-01:engine:${hashIp("203.0.113.7", "salt")}`);
    expect(keys.join(" ")).not.toContain("203.0.113.7");
    expect(hashIp("203.0.113.7", "a")).not.toBe(hashIp("203.0.113.7", "b"));
  });

  it("refuses when the store fails and undoes what landed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const memory = new MemoryQuotaStore();
    let n = 0;
    const flaky: QuotaStore = {
      incrBy: (key, by, ttl) => {
        n += 1;
        return n === 2 ? Promise.reject(new Error("down")) : memory.incrBy(key, by, ttl);
      },
    };
    const q = createQuota({ store: flaky, salt: "s", now: () => DAY });
    expect(await q.checkAndCharge("ip", "forge", 0.1)).toEqual({ ok: false, code: "quota" });
    expect(memory.entries().every(([, v]) => v === 0)).toBe(true);
  });

  it("rejects a negative or non-finite charge as a programming error", async () => {
    const { q } = quota(DEFAULT_LIMITS);
    await expect(q.checkAndCharge("ip", "forge", -1)).rejects.toThrow(RangeError);
    await expect(q.checkAndCharge("ip", "forge", Number.NaN)).rejects.toThrow(RangeError);
  });
});

describe("configuration", () => {
  it("reads limits from env with defaults for blank or invalid values", () => {
    expect(quotaLimits({})).toEqual({ perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 });
    expect(quotaLimits({ SR_FORGE_PER_IP: "7", SR_ENGINE_PER_IP: "x", SR_VOICE_PER_IP: "-1", SR_DAILY_USD_CAP: "2.5" })).toEqual({
      perIp: { forge: 7, engine: 60, voice: 60 },
      dailyUsd: 2.5,
    });
  });

  it("fails closed on a Vercel deploy without KV, or with a broken KV configuration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(quotaFromEnv({ VERCEL_ENV: "production" })).toBe(CLOSED_QUOTA);
    expect(quotaFromEnv({ KV_REST_API_URL: "http://kv.example", KV_REST_API_TOKEN: "t0ken" })).toBe(CLOSED_QUOTA);
    expect(quotaFromEnv({ KV_REST_API_URL: "https://kv.example" })).toBe(CLOSED_QUOTA);
    expect(await CLOSED_QUOTA.checkAndCharge("ip", "voice", 0)).toEqual({ ok: false, code: "quota" });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("t0ken");
  });

  it("uses memory counters in local development", async () => {
    const q = quotaFromEnv({ SR_FORGE_PER_IP: "1" });
    expect(q).not.toBe(CLOSED_QUOTA);
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(true);
    expect((await q.checkAndCharge("ip", "forge", 0)).ok).toBe(false);
  });

  it("checkAndCharge(ip, kind, usd) uses the injected shared quota", async () => {
    setSharedQuota(CLOSED_QUOTA);
    expect(await checkAndCharge("ip", "engine", COST_USD.engineReply)).toEqual({ ok: false, code: "quota" });
  });

  it("clientIp prefers x-real-ip, then the first x-forwarded-for hop", () => {
    const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
    expect(clientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
