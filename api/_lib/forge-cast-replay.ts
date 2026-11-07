// forge-creator L2, the replay twin of casting (api/_lib/forge-cast.ts): three recorded candidates
// from assets/replay/forge/: the job recorded from the brief's request (a cast member) first, then
// others in the order the request fixes (`castTrio`, the same pure rule as the browser's twin). No
// key, no quota, no fetch, no state: the batch id carries the round, the start time and the slugs.
// A re-roll moves on to the next three recordings, at most MAX_REROLLS times. Casting a candidate
// (POST /api/forge with `candidate`, forge-replay.ts) plays that recorded job, labelled RECORDED.
import { castTrio, MAX_REROLLS, parseCastRequest, parseReplayBatchId, replayBatchId, replayCastView, requestKey } from "@sr/forge";
import { errorBody } from "./errors.js";
import type { CastReplay } from "./forge-cast.js";
import { bundledJobs, type ReplayJob } from "./forge-replay.js";

const NO_STORE = { "cache-control": "no-store" };

export function createCastReplay(jobs: readonly ReplayJob[]): CastReplay {
  const bySlug = new Map(jobs.map((j) => [j.slug, j]));
  const slugs = jobs.map((j) => j.slug);
  const refuse = (code: "bad_input" | "quota" | "upstream", message: string, status: number) => Response.json(errorBody(code, message), { status, headers: NO_STORE });
  return {
    async post(body, now) {
      const parsed = parseCastRequest(body);
      if (!parsed.ok) return refuse("bad_input", parsed.errors.message, 400);
      const { brief, after } = parsed.value;
      const previous = after === undefined ? undefined : parseReplayBatchId(after);
      if (after !== undefined && previous === undefined) return refuse("bad_input", "No such casting batch.", 400);
      const round = previous === undefined ? 0 : previous.round + 1;
      if (round > MAX_REROLLS) return refuse("quota", "No re-rolls left for this brief. Cast one of these, or go back to the brief.", 429);
      const key = brief.one_line_request;
      const primary = jobs.find((j) => j.prompt !== undefined && requestKey(j.prompt) === requestKey(key))?.slug;
      const trio = castTrio(key, slugs, primary, round);
      if (trio.length === 0) return refuse("upstream", "No recorded forges are available.", 502);
      const batchId = replayBatchId({ round, startedAt: now, slugs: trio, primary: round === 0 && primary !== undefined });
      return Response.json({ batchId }, { status: 202, headers: NO_STORE });
    },
    async get(batchId, now) {
      const batch = parseReplayBatchId(batchId);
      const view = batch === undefined ? undefined : replayCastView(batchId, batch, bySlug, Math.max(0, now - batch.startedAt));
      if (view === undefined) return refuse("bad_input", "No such casting batch.", 404);
      return Response.json(view, { headers: NO_STORE });
    },
  };
}

let shared: CastReplay | undefined;

/** The recorded casting over the committed jobs, built on first use. */
export const bundledCastReplay: CastReplay = {
  post: (body, now) => (shared ??= createCastReplay(bundledJobs())).post(body, now),
  get: (batchId, now) => (shared ??= createCastReplay(bundledJobs())).get(batchId, now),
};
