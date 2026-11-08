// Job store (task 6.3): the memory backend for real; KV and Blob only as injected fakes.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JOB_TTL_SECONDS,
  MAX_JOB_BYTES,
  MemoryJobStore,
  RedisBlobJobStore,
  isBlobUrl,
  isJobId,
  jobStoreFor,
  newJobId,
  type BlobClient,
  type ParseJob,
} from "../_lib/jobstore.js";
import type { KvClient } from "../_lib/kv.js";
import { runForgeGc, sweepForgeBlobs } from "../cron/forge-gc.js";

interface Job {
  jobId: string;
  status: string;
  urls?: Record<string, string>;
}

/** Test-side validator standing in for the forge's `parseForgeJob` (task 7). */
const parse: ParseJob<Job> = (text) => {
  const v: unknown = JSON.parse(text);
  if (typeof v !== "object" || v === null || !("jobId" in v) || !("status" in v)) return undefined;
  return typeof v.jobId === "string" && typeof v.status === "string" ? { jobId: v.jobId, status: v.status } : undefined;
};

const ID = "abcdef0123456789";
const PNG = { bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), contentType: "image/png" };

function fakeKv(): KvClient & { data: Map<string, { value: string; ttl: number }> } {
  const data = new Map<string, { value: string; ttl: number }>();
  return {
    data,
    get: async (k) => data.get(k)?.value ?? null,
    set: async (k, value, ttl) => void data.set(k, { value, ttl }),
    incrBy: async () => 0,
  };
}

function fakeBlob(): BlobClient & { puts: string[]; deleted: string[] } {
  const puts: string[] = [];
  const deleted: string[] = [];
  return {
    puts,
    deleted,
    put: async (pathname) => {
      puts.push(pathname);
      return { url: `https://store1.public.blob.vercel-storage.com/${pathname.replace(".png", "-RANDOM.png")}` };
    },
    list: async () => ({ blobs: [], hasMore: false }),
    del: async (urls) => void deleted.push(...urls),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("job ids", () => {
  it("new ids are valid and unique; path-like or short ids are not", () => {
    const ids = Array.from({ length: 50 }, newJobId);
    expect(ids.every(isJobId)).toBe(true);
    expect(new Set(ids).size).toBe(50);
    for (const bad of ["", "short", "../../etc/passwd", "abc def 0123456", "a".repeat(65)]) expect(isJobId(bad)).toBe(false);
  });
});

describe("MemoryJobStore", () => {
  it("round-trips any record and hands out copies, never the stored object", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), fc.dictionary(fc.string({ maxLength: 8 }), fc.webUrl(), { maxKeys: 5 }), async (status, urls) => {
        const store = new MemoryJobStore<Job>();
        const job: Job = { jobId: ID, status, urls };
        await store.put(job);
        job.status = "mutated";
        const got = await store.get(ID);
        expect(got).toEqual({ jobId: ID, status, urls });
        if (got) got.status = "mutated again";
        expect((await store.get(ID))?.status).toBe(status);
      }),
    );
  });

  it("forgets a job after 24 h", async () => {
    let now = 0;
    const store = new MemoryJobStore<Job>(() => now);
    await store.put({ jobId: ID, status: "queued" });
    now = JOB_TTL_SECONDS * 1000 - 1;
    expect(await store.get(ID)).toBeDefined();
    now += 1;
    expect(await store.get(ID)).toBeUndefined();
  });

  it("refuses a bad id, but holds records with inline data: URLs past the KV cap", async () => {
    const store = new MemoryJobStore<Job>();
    await expect(store.put({ jobId: "../x", status: "q" })).rejects.toThrow(RangeError);
    await store.put({ jobId: ID, status: "x".repeat(MAX_JOB_BYTES) });
    expect((await store.get(ID))?.status).toHaveLength(MAX_JOB_BYTES);
  });

  it("stores images as data: URLs and reads them back", async () => {
    const store = new MemoryJobStore<Job>();
    const url = await store.putImage(ID, "portrait.png", PNG);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(await store.readImage(url)).toEqual(PNG.bytes);
    await expect(store.readImage("https://evil.example/x.png")).rejects.toThrow(RangeError);
    await expect(store.putImage(ID, "../x.png", PNG)).rejects.toThrow(RangeError);
    await expect(store.putImage(ID, "x.svg", { ...PNG, contentType: "image/svg+xml" })).rejects.toThrow(RangeError);
  });
  it("stores a socketed eye's expression socket (<layer>.<family>.socket.png) and still refuses paths", async () => {
    const store = new MemoryJobStore<Job>();
    for (const file of ["eye_l.png", "head.joy.png", "eye_l.socket.png", "eye_l.joy.socket.png"]) {
      expect((await store.putImage(ID, file, PNG)).startsWith("data:image/png;base64,")).toBe(true);
    }
    for (const file of ["a..png", "a.b.c.d.png", ".png", "a/b.png", "eye_l..socket.png"]) {
      await expect(store.putImage(ID, file, PNG)).rejects.toThrow(RangeError);
    }
  });
});

describe("RedisBlobJobStore (fake KV and Blob)", () => {
  it("keeps job JSON in KV under job:<id> with a 24 h TTL, through the validator", async () => {
    const kv = fakeKv();
    const store = new RedisBlobJobStore<Job>({ kv, blob: fakeBlob(), parse });
    await store.put({ jobId: ID, status: "portrait" });
    expect(kv.data.get(`job:${ID}`)?.ttl).toBe(JOB_TTL_SECONDS);
    expect(await store.get(ID)).toEqual({ jobId: ID, status: "portrait" });
    kv.data.set(`job:${ID}`, { value: '{"nope":1}', ttl: 1 });
    expect(await store.get(ID)).toBeUndefined();
    kv.data.set(`job:${ID}`, { value: '{"jobId":"zzzzzzzzzzzzzzzz","status":"done"}', ttl: 1 });
    expect(await store.get(ID)).toBeUndefined();
    expect(await store.get("../../x")).toBeUndefined();
    await expect(store.put({ jobId: ID, status: "x".repeat(MAX_JOB_BYTES) })).rejects.toMatchObject({ code: "upstream" });
  });

  it("puts images in Blob under forge/<jobId>/ and never in KV", async () => {
    const kv = fakeKv();
    const blob = fakeBlob();
    const store = new RedisBlobJobStore<Job>({ kv, blob, parse });
    const url = await store.putImage(ID, "layer_head.png", PNG);
    expect(blob.puts).toEqual([`forge/${ID}/layer_head.png`]);
    expect(isBlobUrl(url)).toBe(true);
    expect(kv.data.size).toBe(0);
  });

  it("reads back only Blob URLs, through the injected fetch", async () => {
    const fetched: string[] = [];
    const store = new RedisBlobJobStore<Job>({
      kv: fakeKv(),
      blob: fakeBlob(),
      parse,
      fetch: async (url) => {
        fetched.push(url);
        return new Response(PNG.bytes);
      },
    });
    const url = "https://store1.public.blob.vercel-storage.com/forge/x/p.png";
    expect(await store.readImage(url)).toEqual(PNG.bytes);
    await expect(store.readImage("http://169.254.169.254/latest")).rejects.toThrow(RangeError);
    await expect(store.readImage("https://public.blob.vercel-storage.com.evil.example/x")).rejects.toThrow(RangeError);
    expect(fetched).toEqual([url]);
  });

  it("a Blob failure is a generic upstream error", async () => {
    const blob = { ...fakeBlob(), put: () => Promise.reject(new Error("token SECRET rejected")) };
    const err = await new RedisBlobJobStore<Job>({ kv: fakeKv(), blob, parse }).putImage(ID, "a.png", PNG).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "upstream", message: "Storage is unavailable." });
  });
});

describe("jobStoreFor", () => {
  const memory = new MemoryJobStore<Job>();

  it("replay always uses memory, even with credentials", () => {
    expect(jobStoreFor("replay", { KV_REST_API_URL: "https://kv", KV_REST_API_TOKEN: "t" }, { parse, memory, kv: fakeKv(), blob: fakeBlob() })).toBe(memory);
  });

  it("live uses KV + Blob when both exist, memory in local dev without them", () => {
    expect(jobStoreFor("live", {}, { parse, memory, kv: fakeKv(), blob: fakeBlob() }).backend).toBe("redis-blob");
    expect(jobStoreFor("live", {}, { parse, memory })).toBe(memory);
    expect(jobStoreFor("live", {}, { parse, memory, kv: fakeKv() })).toBe(memory);
  });

  it("live on a deploy without KV or Blob refuses with upstream", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => jobStoreFor("live", { VERCEL_ENV: "production" }, { parse, memory, kv: fakeKv() })).toThrow("The forge is not configured.");
  });
});

describe("forge-gc cron", () => {
  const OLD = new Date("2026-10-30T00:00:00Z");
  const NEW = new Date("2026-11-01T11:00:00Z");
  const NOW = new Date("2026-11-01T12:00:00Z");

  function pagedBlob(count: number) {
    const blob = fakeBlob();
    const all = Array.from({ length: count }, (_, i) => ({ url: `https://s.public.blob.vercel-storage.com/forge/${i}.png`, uploadedAt: i % 3 === 0 ? NEW : OLD }));
    blob.list = async (_prefix, cursor) => {
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 100);
      const next = start + 100;
      return next < all.length ? { blobs: page, hasMore: true, cursor: String(next) } : { blobs: page, hasMore: false };
    };
    return { blob, all };
  }

  it("deletes every forge blob older than 24 h across pages, in batches", async () => {
    const { blob, all } = pagedBlob(250);
    const deleted = await sweepForgeBlobs(blob, NOW);
    const expected = all.filter((b) => b.uploadedAt === OLD).map((b) => b.url);
    expect(deleted).toBe(expected.length);
    expect(blob.deleted).toEqual(expected);
  });

  it("runs only with the cron secret, and never without one configured", async () => {
    const { blob } = pagedBlob(3);
    const req = (auth?: string) => ({ headers: new Headers(auth ? { authorization: auth } : {}) });
    expect((await runForgeGc(req("Bearer s3cret"), {}, blob, NOW)).status).toBe(401);
    expect((await runForgeGc(req("Bearer wrong"), { CRON_SECRET: "s3cret" }, blob, NOW)).status).toBe(401);
    const ok = await runForgeGc(req("Bearer s3cret"), { CRON_SECRET: "s3cret" }, blob, NOW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deleted: 2 });
    expect(await (await runForgeGc(req("Bearer s3cret"), { CRON_SECRET: "s3cret" }, undefined, NOW)).json()).toEqual({ deleted: 0, skipped: "no blob store" });
  });
});
