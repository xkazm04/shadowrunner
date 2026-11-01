// GET /api/cron/forge-gc - daily sweep of forge images in Vercel Blob (forge-pipeline design.md
// "Job store"): every blob under `forge/` older than 24 h is deleted, so uploads and generated
// layers never outlive their job (requirement 2.4). Vercel Cron calls it with
// `Authorization: Bearer <CRON_SECRET>`; without a configured secret the sweep refuses to run.
import { timingSafeEqual } from "node:crypto";
import { errorBody } from "../_lib/errors.js";
import { BLOB_PREFIX, JOB_TTL_SECONDS, blobFromEnv, type BlobClient } from "../_lib/jobstore.js";
import type { Env, PlaneRequest } from "../_lib/plane.js";

const DELETE_BATCH = 100;

/** Deletes every blob under `forge/` uploaded more than `maxAgeMs` before `now`; returns the count. */
export async function sweepForgeBlobs(blob: BlobClient, now: Date, maxAgeMs: number = JOB_TTL_SECONDS * 1000): Promise<number> {
  const cutoff = now.getTime() - maxAgeMs;
  const stale: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await blob.list(BLOB_PREFIX, cursor);
    for (const b of page.blobs) if (b.uploadedAt.getTime() < cutoff) stale.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < stale.length; i += DELETE_BATCH) await blob.del(stale.slice(i, i + DELETE_BATCH));
  return stale.length;
}

/** True when the request carries `Bearer <CRON_SECRET>`; false when no secret is configured. */
export function isCronRequest(req: PlaneRequest, env: Env = process.env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function runForgeGc(req: PlaneRequest, env: Env, blob: BlobClient | undefined, now: Date): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!isCronRequest(req, env)) return Response.json(errorBody("bad_input", "Not allowed."), { status: 401, headers });
  if (!blob) return Response.json({ deleted: 0, skipped: "no blob store" }, { headers });
  try {
    const deleted = await sweepForgeBlobs(blob, now);
    return Response.json({ deleted }, { headers });
  } catch {
    console.error("forge-gc: blob store failed");
    return Response.json(errorBody("upstream", "Storage is unavailable."), { status: 502, headers });
  }
}

export function GET(request: Request): Promise<Response> {
  return runForgeGc(request, process.env, blobFromEnv(process.env), new Date());
}
