// Daily quota for paid calls (forge-pipeline requirement 7.3, design.md "Quota"), shared with
// voice-and-air: `await checkAndCharge(ip, kind, usd)` before every paid call.
// - per IP and kind: a daily count (`SR_FORGE_PER_IP` 3, `SR_ENGINE_PER_IP` 60, `SR_VOICE_PER_IP` 60);
// - global: a daily USD estimate against `SR_DAILY_USD_CAP` (30; character-control raised it from 5 for the expression edits), estimates from costs.ts.
// Keys `quota:<yyyy-mm-dd UTC>:<kind>:<ipHash>` and `quota:<date>:usd`; the IP is stored only as
// HMAC-SHA-256 with a server salt. Counters live in KV (Upstash REST) when `KV_REST_API_URL` is set,
// in memory otherwise; a Vercel deploy without KV fails closed, because per-instance memory
// cannot hold a global cap. A refused call charges nothing. The KV client is injected (kv.ts), so
// tests run on `MemoryQuotaStore` only.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { isDeployed, kvFromEnv, type FetchLike, type KvClient } from "./kv.js";
import type { Env, PlaneRequest } from "./plane.js";

export const QUOTA_KINDS = ["forge", "engine", "voice"] as const;
export type QuotaKind = (typeof QUOTA_KINDS)[number];
export type QuotaResult = { ok: true } | { ok: false; code: "quota" };

export interface ChargeOptions {
  /**
   * `false` charges the USD estimate without counting another use against the per-IP limit:
   * a further paid call inside one forge (draft then final, a parts re-ask, the fill edit).
   */
  count?: boolean;
}

export interface Quota {
  checkAndCharge(ip: string, kind: QuotaKind, usd: number, options?: ChargeOptions): Promise<QuotaResult>;
}

export type QuotaStore = Pick<KvClient, "incrBy">;

export interface QuotaLimits {
  perIp: Readonly<Record<QuotaKind, number>>;
  dailyUsd: number;
}

export const DEFAULT_LIMITS: QuotaLimits = { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 };

/** Counters outlive their day by one, so a request across midnight UTC still finds its key. */
export const QUOTA_TTL_SECONDS = 2 * 24 * 60 * 60;

const MICRO = 1_000_000;
const REFUSED: QuotaResult = { ok: false, code: "quota" };

/** Limits from env; an empty, negative or non-numeric value means the default. */
export function quotaLimits(env: Env = process.env): QuotaLimits {
  const read = (value: string | undefined, fallback: number, integer: boolean) => {
    const text = value?.trim();
    const n = text ? Number(text) : Number.NaN;
    if (!Number.isFinite(n) || n < 0) return fallback;
    return integer ? Math.floor(n) : n;
  };
  return {
    perIp: {
      forge: read(env.SR_FORGE_PER_IP, DEFAULT_LIMITS.perIp.forge, true),
      engine: read(env.SR_ENGINE_PER_IP, DEFAULT_LIMITS.perIp.engine, true),
      voice: read(env.SR_VOICE_PER_IP, DEFAULT_LIMITS.perIp.voice, true),
    },
    dailyUsd: read(env.SR_DAILY_USD_CAP, DEFAULT_LIMITS.dailyUsd, false),
  };
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface QuotaConfig {
  store: QuotaStore;
  /** Server salt for the IP hash. */
  salt: string;
  limits?: QuotaLimits;
  now?: () => Date;
}

export function createQuota(config: QuotaConfig): Quota {
  const { store, salt } = config;
  const limits = config.limits ?? DEFAULT_LIMITS;
  const now = config.now ?? (() => new Date());
  const capMicro = Math.round(limits.dailyUsd * MICRO);

  return {
    async checkAndCharge(ip, kind, usd, options = {}) {
      if (!Number.isFinite(usd) || usd < 0) throw new RangeError("checkAndCharge: usd must be a finite number >= 0");
      // An unknown kind has no limit to check against: refuse rather than let it through uncounted.
      if (!QUOTA_KINDS.includes(kind)) return REFUSED;
      const day = utcDay(now());
      const ipKey = `quota:${day}:${kind}:${hashIp(ip, salt)}`;
      const usdKey = `quota:${day}:usd`;
      const micro = Math.round(usd * MICRO);
      const counted = options.count !== false;
      const undo: [string, number][] = [];
      try {
        // Each increment is recorded for undo only once it is known to have landed, so a failed
        // call can over-count (fail safe) but never hand back a charge it did not make.
        if (counted) {
          const uses = await store.incrBy(ipKey, 1, QUOTA_TTL_SECONDS);
          undo.push([ipKey, -1]);
          if (uses > limits.perIp[kind]) return await refuse(store, undo);
        }
        const spent = await store.incrBy(usdKey, micro, QUOTA_TTL_SECONDS);
        undo.push([usdKey, -micro]);
        if (spent > capMicro) return await refuse(store, undo);
        return { ok: true };
      } catch {
        // The counters cannot be read: no paid call. Undo what is known to have landed.
        console.warn("quota: store unavailable, refusing");
        return await refuse(store, undo);
      }
    },
  };
}

async function refuse(store: QuotaStore, undo: [string, number][]): Promise<QuotaResult> {
  for (const [key, by] of undo) await store.incrBy(key, by, QUOTA_TTL_SECONDS).catch(() => undefined);
  return REFUSED;
}

export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex");
}

/** Refuses every call: a deploy whose counters cannot be shared must not spend. */
export const CLOSED_QUOTA: Quota = { checkAndCharge: async () => REFUSED };

/** In-memory counters with TTL (replay, `pnpm dev`, tests). */
export class MemoryQuotaStore implements QuotaStore {
  readonly #counters = new Map<string, { value: number; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    const at = this.#now();
    const current = this.#counters.get(key);
    const value = (current && current.expiresAt > at ? current.value : 0) + by;
    this.#counters.set(key, { value, expiresAt: at + ttlSeconds * 1000 });
    return value;
  }

  /** Live keys and values, for tests and diagnostics. */
  entries(): [string, number][] {
    const at = this.#now();
    return [...this.#counters].filter(([, c]) => c.expiresAt > at).map(([k, c]) => [k, c.value]);
  }
}

/**
 * The quota for this environment: KV counters when configured; memory in development; closed on a
 * deploy without KV or with a broken KV configuration. The salt is `SR_QUOTA_SALT`, else derived
 * from the KV token (stable across instances), else random per process (memory only).
 */
export function quotaFromEnv(env: Env = process.env, fetchImpl?: FetchLike): Quota {
  const limits = quotaLimits(env);
  const salt = env.SR_QUOTA_SALT?.trim();
  let kv: KvClient | undefined;
  try {
    kv = kvFromEnv(env, fetchImpl);
  } catch {
    console.warn("quota: KV misconfigured, refusing paid calls");
    return CLOSED_QUOTA;
  }
  if (kv) {
    const derived = createHash("sha256").update(`sr-quota-salt:${env.KV_REST_API_TOKEN?.trim() ?? ""}`).digest("hex");
    return createQuota({ store: kv, limits, salt: salt || derived });
  }
  if (isDeployed(env)) {
    console.warn("quota: no KV on a deploy, refusing paid calls");
    return CLOSED_QUOTA;
  }
  return createQuota({ store: new MemoryQuotaStore(), limits, salt: salt || randomBytes(32).toString("hex") });
}

let shared: Quota | undefined;

/**
 * Charges one paid call for `ip` (see `clientIp`). Resolves `{ ok: false, code: "quota" }` when the
 * per-IP count or the global USD cap would be exceeded; then nothing is charged and the caller
 * must answer `quota` without making the call.
 */
export function checkAndCharge(ip: string, kind: QuotaKind, usd: number, options?: ChargeOptions): Promise<QuotaResult> {
  shared ??= quotaFromEnv(process.env);
  return shared.checkAndCharge(ip, kind, usd, options);
}

/** Replaces the shared quota (tests inject a `createQuota` over `MemoryQuotaStore`); undefined resets it. */
export function setSharedQuota(quota: Quota | undefined): void {
  shared = quota;
}

/** The caller's IP as Vercel's edge reports it (it overwrites client-sent forwarding headers). */
export function clientIp(req: PlaneRequest): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
