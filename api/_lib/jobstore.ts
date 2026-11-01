// Forge job store (forge-pipeline design.md "Job store", requirement 7.2). Job JSON and images live
// apart: on the live plane the job record sits in KV (`job:<id>`, TTL 24 h, at most 50 KB) and every
// image in Vercel Blob (`forge/<jobId>/<file>`, random suffix, swept by api/cron/forge-gc.ts); on
// replay and in `pnpm dev` without credentials both live in memory, images as data: URLs. Images
// never sit in KV. The KV and Blob clients are injected, so tests run only the memory backend and
// fakes. Reading a record back goes through the caller's validator (`parse`), never a bare cast.
import { del, list, put } from "@vercel/blob";
import { ApiError } from "./errors.js";
import { isDeployed, kvFromEnv, type FetchLike, type KvClient } from "./kv.js";
import type { Env } from "./plane.js";

export const JOB_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound of one serialized job record (statuses, parts, URLs; never image bytes). */
export const MAX_JOB_BYTES = 50_000;
/** Upper bound of one image read back from the store (a 1024 px RGBA PNG stays well under it). */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const BLOB_PREFIX = "forge/";

export interface StoredJob {
  jobId: string;
}

export interface StoredImage {
  bytes: Uint8Array;
  contentType: string;
}

/** Validates one record read back from KV; undefined means "not a job" (treated as missing). */
export type ParseJob<J> = (text: string) => J | undefined;

export interface JobStore<J extends StoredJob> {
  readonly backend: "memory" | "redis-blob";
  get(jobId: string): Promise<J | undefined>;
  /** Creates or replaces the record and restarts its 24 h TTL. */
  put(job: J): Promise<void>;
  /** Stores one image of the job and returns the URL the client loads it from. */
  putImage(jobId: string, file: string, image: StoredImage): Promise<string>;
  /** Reads back an image this store handed out (a later step needs the portrait or the plate). */
  readImage(url: string): Promise<Uint8Array>;
}

const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
const FILE = /^[A-Za-z0-9_-]{1,64}\.(?:png|jpe?g|webp)$/;
const CONTENT_TYPE = /^image\/(?:png|jpeg|webp)$/;

export function isJobId(value: string): boolean {
  return JOB_ID.test(value);
}

/** A fresh job id: 128 random bits, URL-safe. */
export function newJobId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

const storageError = () => new ApiError("upstream", "Storage is unavailable.");
const tooLarge = () => new ApiError("upstream", "The forge job grew too large.");

function checkImageArgs(jobId: string, file: string, image: StoredImage): void {
  if (!isJobId(jobId) || !FILE.test(file) || !CONTENT_TYPE.test(image.contentType)) {
    throw new RangeError("putImage: bad job id, file name or content type");
  }
}

function serialize(job: StoredJob): string {
  if (!isJobId(job.jobId)) throw new RangeError("put: bad job id");
  const text = JSON.stringify(job);
  if (Buffer.byteLength(text, "utf8") > MAX_JOB_BYTES) throw tooLarge();
  return text;
}

/** Replay and `pnpm dev`: records cloned in a map with the same TTL and size cap, images as data: URLs. */
export class MemoryJobStore<J extends StoredJob> implements JobStore<J> {
  readonly backend = "memory";
  readonly #jobs = new Map<string, { job: J; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async get(jobId: string): Promise<J | undefined> {
    const entry = this.#jobs.get(jobId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#jobs.delete(jobId);
      return undefined;
    }
    return structuredClone(entry.job);
  }

  async put(job: J): Promise<void> {
    serialize(job);
    this.#jobs.set(job.jobId, { job: structuredClone(job), expiresAt: this.#now() + JOB_TTL_SECONDS * 1000 });
  }

  async putImage(jobId: string, file: string, image: StoredImage): Promise<string> {
    checkImageArgs(jobId, file, image);
    return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
  }

  async readImage(url: string): Promise<Uint8Array> {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match?.[1]) throw new RangeError("readImage: not an image data: URL");
    return new Uint8Array(Buffer.from(match[1], "base64"));
  }
}

/** The Vercel Blob operations the forge needs (`@vercel/blob` in production, a fake in tests). */
export interface BlobClient {
  /** Public, random-suffixed upload; returns the blob's https URL. */
  put(pathname: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
  list(prefix: string, cursor?: string): Promise<{ blobs: { url: string; uploadedAt: Date }[]; cursor?: string; hasMore: boolean }>;
  del(urls: string[]): Promise<void>;
}

/** Hosts a Vercel Blob store serves from; `readImage` fetches nothing else. */
const BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/;

export function isBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && BLOB_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export interface RedisBlobConfig<J> {
  kv: KvClient;
  blob: BlobClient;
  parse: ParseJob<J>;
  fetch?: FetchLike;
}

/** Live plane: job JSON in KV, images in Vercel Blob. */
export class RedisBlobJobStore<J extends StoredJob> implements JobStore<J> {
  readonly backend = "redis-blob";
  readonly #kv: KvClient;
  readonly #blob: BlobClient;
  readonly #parse: ParseJob<J>;
  readonly #fetch: FetchLike;

  constructor(config: RedisBlobConfig<J>) {
    this.#kv = config.kv;
    this.#blob = config.blob;
    this.#parse = config.parse;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async get(jobId: string): Promise<J | undefined> {
    if (!isJobId(jobId)) return undefined;
    const text = await this.#kv.get(`job:${jobId}`);
    if (text === null) return undefined;
    const job = this.#parse(text);
    // A record that does not validate, or claims another id, is not this job.
    return job && job.jobId === jobId ? job : undefined;
  }

  async put(job: J): Promise<void> {
    await this.#kv.set(`job:${job.jobId}`, serialize(job), JOB_TTL_SECONDS);
  }

  async putImage(jobId: string, file: string, image: StoredImage): Promise<string> {
    checkImageArgs(jobId, file, image);
    try {
      const { url } = await this.#blob.put(`${BLOB_PREFIX}${jobId}/${file}`, image.bytes, image.contentType);
      if (!isBlobUrl(url)) throw storageError();
      return url;
    } catch {
      throw storageError();
    }
  }

  async readImage(url: string): Promise<Uint8Array> {
    if (!isBlobUrl(url)) throw new RangeError("readImage: not a Vercel Blob URL");
    let res: Response;
    try {
      res = await this.#fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw storageError();
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw storageError();
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw storageError();
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      throw storageError();
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw storageError();
    return bytes;
  }
}

/** `@vercel/blob` with the store's read-write token; uploads are public with a random suffix. */
export function vercelBlob(token: string): BlobClient {
  return {
    async put(pathname, body, contentType) {
      const result = await put(pathname, Buffer.from(body), { access: "public", addRandomSuffix: true, contentType, token });
      return { url: result.url };
    },
    async list(prefix, cursor) {
      const result = await list({ prefix, token, limit: 1000, ...(cursor ? { cursor } : {}) });
      return {
        blobs: result.blobs.map((b) => ({ url: b.url, uploadedAt: b.uploadedAt })),
        hasMore: result.hasMore,
        ...(result.cursor ? { cursor: result.cursor } : {}),
      };
    },
    async del(urls) {
      await del(urls, { token });
    },
  };
}

/** The Blob client named by `BLOB_READ_WRITE_TOKEN`, or undefined when it is not set. */
export function blobFromEnv(env: Env = process.env): BlobClient | undefined {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? vercelBlob(token) : undefined;
}

export interface JobStoreDeps<J extends StoredJob> {
  parse: ParseJob<J>;
  /** The process-wide memory store the caller owns (it must outlive one request in `pnpm dev`). */
  memory: MemoryJobStore<J>;
  kv?: KvClient;
  blob?: BlobClient;
  fetch?: FetchLike;
}

/**
 * The store for one request. Replay: memory. Live: KV + Blob when `KV_REST_API_URL` and
 * `BLOB_READ_WRITE_TOKEN` are set; memory in local development without them; on a Vercel deploy
 * without them an `ApiError("upstream")`, because function memory cannot hold a job across steps.
 */
export function jobStoreFor<J extends StoredJob>(plane: "replay" | "live", env: Env, deps: JobStoreDeps<J>): JobStore<J> {
  if (plane === "replay") return deps.memory;
  let kv: KvClient | undefined;
  try {
    kv = deps.kv ?? kvFromEnv(env, deps.fetch);
  } catch {
    kv = undefined;
  }
  const blob = deps.blob ?? blobFromEnv(env);
  if (kv && blob) return new RedisBlobJobStore({ kv, blob, parse: deps.parse, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  if (isDeployed(env)) {
    console.warn("jobstore: no KV or Blob on a deploy, refusing live jobs");
    throw new ApiError("upstream", "The forge is not configured.");
  }
  return deps.memory;
}
