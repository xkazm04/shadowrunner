// The forge job state machine (creator design.md "Contracts", requirement 3). Pure: the polling
// hook (useForgeJob.ts) feeds it events; the panel renders the state.
//
// Decisions the spec leaves open:
// - The running state also carries the original `request` (design.md lists only jobId, status and
//   startedAt), because `failed.retry` must be that request (requirement 3.4) and a failure can
//   arrive in a poll long after the start. `done` carries the job's asset URLs (and the portrait,
//   when shown) next to the rig, because the library stores the assets with the rig (3.3).
// - Status only moves forward through queued < portrait < segmenting < cutting < filling; a poll
//   that reports an earlier status (a stale or reordered response) is ignored.
// - `done` needs a rig that passes `validateRig` and a URL for every layer file; anything less is
//   `failed / upstream`, never a half-shown character.
// - Events for another job id, and events after a terminal state, are ignored; only `start` (a new
//   job) and `reset` (back to the form) leave `done` or `failed`.
import type { ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import { validateRig, type Rig } from "@sr/rig";

export type RunningStatus = Exclude<ForgeStatus, "done" | "failed">;

export type ForgeState =
  | { phase: "idle" }
  | { phase: "running"; jobId: string; status: RunningStatus; startedAt: number; request: ForgeRequest; portraitUrl?: string }
  | { phase: "done"; rig: Rig; assets: Record<string, string>; jobId: string; plane: JobView["plane"]; portraitUrl?: string }
  | { phase: "failed"; code: ForgeErrorCode; message: string; retry: ForgeRequest };

export type ForgeEvent =
  | { type: "start"; jobId: string; request: ForgeRequest; at: number }
  | { type: "view"; view: JobView }
  /** A client-side failure: the start was refused, the network failed, the client timed out. */
  | { type: "fail"; code: ForgeErrorCode; message: string; request: ForgeRequest }
  | { type: "reset" };

/** Running statuses in step order. */
export const RUNNING_ORDER: readonly RunningStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling"];

export const IDLE: ForgeState = { phase: "idle" };

const rank = (s: RunningStatus): number => RUNNING_ORDER.indexOf(s);

function finish(state: Extract<ForgeState, { phase: "running" }>, view: JobView): ForgeState {
  const failed = (message: string): ForgeState => ({ phase: "failed", code: "upstream", message, retry: state.request });
  if (view.rig === undefined || view.assets === undefined) return failed("The forge finished without a character.");
  const rig = validateRig(view.rig);
  if (!rig.ok) return failed("The forge returned a character the creator cannot read.");
  const assets = view.assets;
  if (rig.value.layers.some((layer) => assets[layer.file] === undefined)) return failed("The forge returned a character with missing parts.");
  const portraitUrl = view.portraitUrl ?? state.portraitUrl;
  const done: ForgeState = { phase: "done", rig: rig.value, assets: { ...assets }, jobId: state.jobId, plane: view.plane };
  if (portraitUrl !== undefined) done.portraitUrl = portraitUrl;
  return done;
}

export function forgeReducer(state: ForgeState, event: ForgeEvent): ForgeState {
  switch (event.type) {
    case "start":
      if (state.phase === "running") return state;
      return { phase: "running", jobId: event.jobId, status: "queued", startedAt: event.at, request: event.request };
    case "reset":
      return state.phase === "running" ? state : IDLE;
    case "fail":
      if (state.phase === "done" || state.phase === "failed") return state;
      return {
        phase: "failed",
        code: event.code,
        message: event.message,
        retry: state.phase === "running" ? state.request : event.request,
      };
    case "view": {
      if (state.phase !== "running" || event.view.jobId !== state.jobId) return state;
      const { view } = event;
      if (view.status === "failed") {
        return {
          phase: "failed",
          code: view.error?.code ?? "upstream",
          message: view.error?.message ?? "The forge failed.",
          retry: state.request,
        };
      }
      if (view.status === "done") return finish(state, view);
      const portraitUrl = view.portraitUrl ?? state.portraitUrl;
      if (rank(view.status) < rank(state.status) || (rank(view.status) === rank(state.status) && portraitUrl === state.portraitUrl)) return state;
      const next: ForgeState = { ...state, status: view.status };
      if (portraitUrl !== undefined) next.portraitUrl = portraitUrl;
      return next;
    }
  }
}
