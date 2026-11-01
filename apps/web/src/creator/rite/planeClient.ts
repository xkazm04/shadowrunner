// The forge client for this plane (creator design.md "Plane and client selection"). Replay forges in
// the browser from the recorded jobs (`?forge=fail:<code>` seeds a failure); live goes to
// /api/forge. A job id minted by the replay client is always polled by it, so a job started before
// health answered still finishes after the plane resolves to live.
import type { ForgeErrorCode } from "@sr/forge/wire";
import type { Plane } from "../../app/plane";
import { createHttpForgeClient, type ForgeClient } from "../forgeClient";
import { createReplayForgeClient, failOf, type ReplayClientOptions } from "../forgeClient.replay";

export function planeClient(plane: Plane, search: string): ForgeClient {
  const fail = failOf(search);
  const replay = createReplayForgeClient(fail === undefined ? {} : { fail });
  if (plane === "replay") return replay;
  const http = createHttpForgeClient();
  return { start: http.start, poll: (jobId) => (jobId.startsWith("replay_") ? replay.poll(jobId) : http.poll(jobId)) };
}

/**
 * `base`, except that while `seeded()` names a code the next start goes to a replay client seeded
 * with it (the rite's "a photo of a real face?" on replay plays the recorded refusal). The code
 * travels in the job id, so `base` polls it to the same end.
 */
export function withSeededStart(base: ForgeClient, seeded: () => ForgeErrorCode | undefined, options: ReplayClientOptions = {}): ForgeClient {
  return {
    start: (req) => {
      const fail = seeded();
      return fail === undefined ? base.start(req) : createReplayForgeClient({ ...options, fail }).start(req);
    },
    poll: base.poll,
  };
}
