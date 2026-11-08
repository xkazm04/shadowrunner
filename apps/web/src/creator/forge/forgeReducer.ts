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
// - A brief job's `decomposition` (cast-forge task 12) is kept from the first view that reports it
//   through `done`, so the creator can say when the brief's parts were not found ("fallback").
// - A live job's `expressions` (character-control) are kept from each view that reports them
//   through `done`, so the rite can count them and name the procedural families; so is S1's `gate`
//   (the view's `expressionGate`: why each procedural family is procedural).
// - forge-creator C1, wake after eyes: an `expressing` view that carries a valid rig with a URL for
//   every layer file makes the running job `awake` (rig + assets, and `awakeAt`, the event's `at`).
//   Later rigs fold in only through `mergeFaces` (faces.ts: additive patches, else the awake rig
//   stays). Once awake nothing fails the job: `done` keeps the awake rig when its own rig is not an
//   additive extension, and a failure (a failed view, a client fail, `settle` at the tail's cap)
//   finishes it as `done` with the faces that arrived; the rest stay procedural.
// - forge-creator S2: a live view's `expiresAt` (the end of the repaint window) is kept from the
//   first view that names it through `done`; a replay job never has one.
import type { FaceGate } from "@sr/forge/faceGate";
import type { Decomposition, ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import { validateRig, type Rig } from "@sr/rig";
import { mergeFaces, type Woken } from "./faces";

export type RunningStatus = Exclude<ForgeStatus, "done" | "failed">;
export type Expressions = NonNullable<JobView["expressions"]>;

export type ForgeState =
  | { phase: "idle" }
  | {
      phase: "running";
      jobId: string;
      status: RunningStatus;
      startedAt: number;
      request: ForgeRequest;
      portraitUrl?: string;
      decomposition?: Decomposition;
      expressions?: Expressions;
      /** S1: why each family that settled without a painted face did. */
      gate?: FaceGate;
      /** C1: the woken character (structure final), from the first valid expressing rig on. */
      awake?: Woken;
      /** C1: when the client first saw the job awake (or, on a resumed job, remembered it), ms. */
      awakeAt?: number;
      /** S2: a live job's end of life (epoch ms), from the first view that names it: the repaint window. */
      expiresAt?: number;
    }
  | { phase: "done"; rig: Rig; assets: Record<string, string>; jobId: string; plane: JobView["plane"]; portraitUrl?: string; decomposition?: Decomposition; expressions?: Expressions; gate?: FaceGate; expiresAt?: number }
  | { phase: "failed"; code: ForgeErrorCode; message: string; retry: ForgeRequest };

export type ForgeEvent =
  | { type: "start"; jobId: string; request: ForgeRequest; at: number; awakeAt?: number }
  | { type: "view"; view: JobView; at?: number }
  /** C1: the faces' tail ran out of time: an awake job is done as it stands, any other fails. */
  | { type: "settle"; message: string }
  /** A client-side failure: the start was refused, the network failed, the client timed out. */
  | { type: "fail"; code: ForgeErrorCode; message: string; request: ForgeRequest }
  | { type: "reset" };

/** Running statuses in step order. */
export const RUNNING_ORDER: readonly RunningStatus[] = ["queued", "portrait", "segmenting", "cutting", "filling", "expressing"];

export const IDLE: ForgeState = { phase: "idle" };

const rank = (s: RunningStatus): number => RUNNING_ORDER.indexOf(s);

type Running = Extract<ForgeState, { phase: "running" }>;

/** The character a view carries (a valid rig, a URL for every layer file), or why not. */
function woken(view: JobView): Woken | string {
  if (view.rig === undefined || view.assets === undefined) return "The forge finished without a character.";
  const rig = validateRig(view.rig);
  if (!rig.ok) return "The forge returned a character the creator cannot read.";
  const assets = view.assets;
  if (rig.value.layers.some((layer) => assets[layer.file] === undefined)) return "The forge returned a character with missing parts.";
  return { rig: rig.value, assets: { ...assets } };
}

const planeOf = (jobId: string): JobView["plane"] => (jobId.startsWith("replay_") ? "replay" : "live");

/** S2: a live job's end of life, from this view or an earlier one (never on replay). */
const expiresOf = (view: JobView, state: Running): number | undefined => (view.plane === "live" ? (view.expiresAt ?? state.expiresAt) : undefined);

/** An awake job as done, with what it has (C1: never a failure once awake). */
function settled(state: Running, awake: Woken, plane: JobView["plane"] = planeOf(state.jobId)): ForgeState {
  return finish(state, { jobId: state.jobId, status: "done", plane, rig: awake.rig, assets: { ...awake.assets } });
}

function finish(state: Running, view: JobView): ForgeState {
  const got = woken(view);
  let character: Woken;
  if (typeof got === "string") {
    if (state.awake === undefined) return { phase: "failed", code: "upstream", message: got, retry: state.request };
    character = state.awake;
  } else {
    character = state.awake === undefined ? got : mergeFaces(state.awake, got);
  }
  const portraitUrl = view.portraitUrl ?? state.portraitUrl;
  const done: ForgeState = { phase: "done", rig: character.rig, assets: { ...character.assets }, jobId: state.jobId, plane: view.plane };
  if (portraitUrl !== undefined) done.portraitUrl = portraitUrl;
  const decomposition = view.decomposition ?? state.decomposition;
  if (decomposition !== undefined) done.decomposition = decomposition;
  const expressions = view.expressions ?? state.expressions;
  if (expressions !== undefined) done.expressions = { ...expressions };
  const gate = view.expressionGate ?? state.gate;
  if (gate !== undefined) done.gate = { ...gate };
  const expiresAt = expiresOf(view, state);
  if (expiresAt !== undefined) done.expiresAt = expiresAt;
  return done;
}

export function forgeReducer(state: ForgeState, event: ForgeEvent): ForgeState {
  switch (event.type) {
    case "start":
      if (state.phase === "running") return state;
      return {
        phase: "running",
        jobId: event.jobId,
        status: "queued",
        startedAt: event.at,
        request: event.request,
        ...(event.awakeAt === undefined ? {} : { awakeAt: event.awakeAt }),
      };
    case "reset":
      return state.phase === "running" ? state : IDLE;
    case "settle":
      if (state.phase !== "running") return state;
      if (state.awake !== undefined) return settled(state, state.awake);
      return { phase: "failed", code: "upstream", message: event.message, retry: state.request };
    case "fail":
      if (state.phase === "done" || state.phase === "failed") return state;
      if (state.phase === "running" && state.awake !== undefined) return settled(state, state.awake);
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
        if (state.awake !== undefined) return settled(state, state.awake, view.plane);
        return {
          phase: "failed",
          code: view.error?.code ?? "upstream",
          message: view.error?.message ?? "The forge failed.",
          retry: state.request,
        };
      }
      if (view.status === "done") return finish(state, view);
      const portraitUrl = view.portraitUrl ?? state.portraitUrl;
      const decomposition = view.decomposition ?? state.decomposition;
      const expressions = view.expressions ?? state.expressions;
      const sameExpressions = JSON.stringify(expressions) === JSON.stringify(state.expressions);
      const gate = view.expressionGate ?? state.gate;
      const sameGate = JSON.stringify(gate) === JSON.stringify(state.gate);
      const expiresAt = expiresOf(view, state);
      if (rank(view.status) < rank(state.status)) return state;
      // C1: only an expressing view wakes the job; a later rig folds in only when it adds faces.
      const got = view.status === "expressing" && view.rig !== undefined ? woken(view) : undefined;
      const character = got === undefined || typeof got === "string" ? state.awake : state.awake === undefined ? got : mergeFaces(state.awake, got);
      const sameStatus = rank(view.status) === rank(state.status);
      if (sameStatus && portraitUrl === state.portraitUrl && decomposition === state.decomposition && sameExpressions && sameGate && character === state.awake && expiresAt === state.expiresAt) return state;
      const next: Running = { ...state, status: view.status };
      if (portraitUrl !== undefined) next.portraitUrl = portraitUrl;
      if (decomposition !== undefined) next.decomposition = decomposition;
      if (expressions !== undefined) next.expressions = { ...expressions };
      if (gate !== undefined) next.gate = { ...gate };
      if (expiresAt !== undefined) next.expiresAt = expiresAt;
      if (character !== undefined) {
        next.awake = character;
        next.awakeAt = state.awakeAt ?? event.at ?? state.startedAt;
      }
      return next;
    }
  }
}
