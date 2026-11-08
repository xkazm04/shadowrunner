// forge-creator S2: the client's door to `POST /api/forge/:jobId/faces` (repaint one face), through
// `apiFetch` (so `?plane=replay` adds `x-sr-plane: replay`). The answer is checked by
// `readRepaintCandidate` (@sr/forge/faceRepaint) before use; every failure is a ForgeError with a
// wire code, and `expired` marks the 404/410 a gone or expired source job answers.
import { readRepaintCandidate } from "@sr/forge/faceRepaint";
import type { RepaintCandidate, RepaintRequest } from "@sr/forge/wire";
import { apiFetch, type Fetcher } from "../../app/plane";
import { FORGE_URL, ForgeError, errorFromBody } from "../forgeClient";

/** A repaint failure: the wire code and message, and whether the source job is gone (expired). */
export class RepaintError extends ForgeError {
  readonly expired: boolean;
  constructor(error: ForgeError, expired: boolean) {
    super(error.code, error.message);
    this.name = "RepaintError";
    this.expired = expired;
  }
}

/** A fresh idempotency key for one Repaint press (REPAINT_KEY: 8..40 of [A-Za-z0-9_-]). */
export function repaintKey(random: () => number = Math.random): string {
  const digits = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "rp-";
  for (let i = 0; i < 20; i++) key += digits[Math.floor(random() * digits.length) % digits.length];
  return key;
}

export async function repaintFace(jobId: string, request: RepaintRequest, fetcher: Fetcher = apiFetch): Promise<RepaintCandidate> {
  let res: Response;
  try {
    res = await fetcher(`${FORGE_URL}/${encodeURIComponent(jobId)}/faces`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
    });
  } catch {
    throw new RepaintError(new ForgeError("upstream", "The forge could not be reached."), false);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) throw new RepaintError(errorFromBody(body, res.status), res.status === 404 || res.status === 410);
  const candidate = readRepaintCandidate(body);
  if (candidate === undefined || candidate.family !== request.family) throw new RepaintError(new ForgeError("upstream", "The forge sent a face the creator cannot read."), false);
  return candidate;
}
