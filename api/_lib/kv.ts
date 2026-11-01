// Shared storage plumbing for the server (forge-pipeline design.md "Job store" and "Quota"):
// the `KvClient` that quota.ts and jobstore.ts both use, and its Upstash Redis REST backend (what
// Vercel's KV marketplace provisions). The backend takes an injected `fetch`, so tests never reach
// the network. Failures are `ApiError("upstream")` with our own message: no upstream body and no
// token ever reaches an error, a response or a log.
import { ApiError } from "./errors.js";
import type { Env } from "./plane.js";

/** The `fetch` subset the server's HTTP clients use; injected in tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The KV operations the server needs. Values are opaque strings; callers validate what they read. */
export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Adds `by` (may be negative), (re)sets the key's TTL, and returns the new value. */
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
}

export interface UpstashConfig {
  url: string;
  token: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const kvError = () => new ApiError("upstream", "Storage is unavailable.");

/** KV over the Upstash Redis REST API: `POST <url>` with a command array, `/multi-exec` for a transaction. */
export function upstashKv(config: UpstashConfig): KvClient {
  const base = config.url.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = config.timeoutMs ?? 5_000;

  async function send(path: string, command: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw kvError();
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw kvError();
    }
    try {
      // The REST envelope only; values inside it stay opaque strings for the caller's validator.
      return await res.json();
    } catch {
      throw kvError();
    }
  }

  const result = (reply: unknown): unknown => {
    if (typeof reply !== "object" || reply === null || "error" in reply || !("result" in reply)) throw kvError();
    return reply.result;
  };

  return {
    async get(key) {
      const value = result(await send("", ["GET", key]));
      if (value === null || typeof value === "string") return value;
      throw kvError();
    },
    async set(key, value, ttlSeconds) {
      result(await send("", ["SET", key, value, "EX", String(ttlSeconds)]));
    },
    async incrBy(key, by, ttlSeconds) {
      const reply = await send("/multi-exec", [
        ["INCRBY", key, String(by)],
        ["EXPIRE", key, String(ttlSeconds)],
      ]);
      const value = Array.isArray(reply) ? result(reply[0]) : undefined;
      if (typeof value !== "number") throw kvError();
      return value;
    },
  };
}

/**
 * The KV client named by `KV_REST_API_URL` / `KV_REST_API_TOKEN`, or undefined when no URL is set.
 * A URL without a token, or not https, is a configuration error (`ApiError("upstream")`).
 */
export function kvFromEnv(env: Env = process.env, fetchImpl?: FetchLike): KvClient | undefined {
  const url = env.KV_REST_API_URL?.trim();
  if (!url) return undefined;
  const token = env.KV_REST_API_TOKEN?.trim();
  if (!token || !url.startsWith("https://")) throw new ApiError("upstream", "Storage is not configured.");
  return upstashKv({ url, token, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

/** True on a Vercel production or preview deploy (not `vercel dev`, not `pnpm dev`). */
export function isDeployed(env: Env = process.env): boolean {
  const target = env.VERCEL_ENV?.trim();
  return target === "production" || target === "preview";
}
