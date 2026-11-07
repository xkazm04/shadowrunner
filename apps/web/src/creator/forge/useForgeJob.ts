// The forge job as React state (creator requirement 3.2, 3.5; design.md "Contracts"): starts a
// job, polls it (1.5 s, backing off to 5 s after 60 s, failing as upstream after 5 minutes),
// remembers it in sessionStorage so leaving the page does not cancel it and coming back resumes
// polling by jobId, and folds every answer through `forgeReducer`.
//
// Decisions the spec leaves open:
// - A poll that throws is retried; three failures in a row end the job as that error (a network
//   blip should not lose a 40-second forge). `bad_input` (the server does not know the job) ends
//   it at once.
// - The stored job keeps the request for retry. A picture too large for sessionStorage is stored
//   without its image; a resumed job that then fails asks for the picture again (bad_input).
//   A brief job (mode "brief") is stored with its brief and resumed only when that brief still
//   passes `parseBrief`.
// - forge-creator C1: the five-minute cap covers only the time to awake (the reducer's `awake`).
//   After that the faces' tail has its own cap, TAIL_TIMEOUT_MS from `awakeAt` (remembered with the
//   stored job, so a reload keeps it); running out of it `settle`s the job: done with the faces that
//   arrived, never failed.
import { parseBrief } from "@sr/forge/brief";
import type { ForgeRequest } from "@sr/forge/wire";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ForgeError, type ForgeClient } from "../forgeClient";
import { forgeReducer, IDLE, type ForgeState } from "./forgeReducer";

export const POLL_MS = 1500;
export const SLOW_POLL_MS = 5000;
export const SLOW_AFTER_MS = 60_000;
export const TIMEOUT_MS = 5 * 60_000;
/** After awake: how long the faces may keep painting before the job settles as it stands. */
export const TAIL_TIMEOUT_MS = 6 * 60_000;
export const MAX_POLL_FAILURES = 3;
export const JOB_KEY = "sr-forge-job";

export interface StoredJob {
  jobId: string;
  startedAt: number;
  request: ForgeRequest;
  /** C1: when the job was first seen awake, ms. */
  awakeAt?: number;
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

/** The job remembered for this tab, if it reads. */
export function readStoredJob(storage: Storage | undefined): StoredJob | undefined {
  try {
    const text = storage?.getItem(JOB_KEY);
    if (text === null || text === undefined) return undefined;
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || typeof value.jobId !== "string" || typeof value.startedAt !== "number" || !isRecord(value.request)) return undefined;
    const r = value.request;
    if (r.mode !== "prompt" && r.mode !== "image" && r.mode !== "brief") return undefined;
    const request: ForgeRequest = { mode: r.mode };
    if (r.mode === "brief") {
      const brief = parseBrief(r.brief);
      if (!brief.ok) return undefined;
      request.brief = brief.value;
    }
    if (typeof r.prompt === "string") request.prompt = r.prompt;
    if (typeof r.imageBase64 === "string") request.imageBase64 = r.imageBase64;
    const awakeAt = typeof value.awakeAt === "number" && Number.isFinite(value.awakeAt) ? { awakeAt: value.awakeAt } : {};
    return { jobId: value.jobId, startedAt: value.startedAt, request, ...awakeAt };
  } catch {
    return undefined;
  }
}

function writeStoredJob(storage: Storage | undefined, job: StoredJob | undefined): void {
  try {
    if (job === undefined) {
      storage?.removeItem(JOB_KEY);
      return;
    }
    try {
      storage?.setItem(JOB_KEY, JSON.stringify(job));
    } catch {
      storage?.setItem(JOB_KEY, JSON.stringify({ ...job, request: { mode: job.request.mode } }));
    }
  } catch {
    // Without storage the job simply does not survive a reload.
  }
}

/** Delay before the next poll, `elapsed` ms into the job. */
export const pollDelay = (elapsed: number): number => (elapsed >= SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS);

function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export interface ForgeJob {
  state: ForgeState;
  /** ms since the job started (0 unless running). */
  elapsedMs: number;
  /** True while the start request is in flight (before there is a job id). */
  starting: boolean;
  start(request: ForgeRequest): void;
  /** Back to the form after done or failed. */
  reset(): void;
}

export interface ForgeJobOptions {
  now?: () => number;
  storage?: Storage;
}

export function useForgeJob(client: ForgeClient, options: ForgeJobOptions = {}): ForgeJob {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? sessionStore();
  const [state, dispatch] = useReducer(forgeReducer, IDLE);
  const [clock, setClock] = useState(() => now());
  const [starting, setStarting] = useState(false);
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  });

  // Resume a job this tab started before it left the page (or reloaded).
  useEffect(() => {
    const stored = readStoredJob(storage);
    if (stored !== undefined) {
      dispatch({ type: "start", jobId: stored.jobId, request: stored.request, at: stored.startedAt, ...(stored.awakeAt === undefined ? {} : { awakeAt: stored.awakeAt }) });
    }
    // Read once at mount.
  }, []);

  const running = state.phase === "running" ? state : undefined;
  // The poll loop reads the latest awake state without restarting on every view.
  const awakeRef = useRef<{ awake: boolean; awakeAt?: number }>({ awake: false });
  const isAwake = running?.awake !== undefined;
  const awakeSince = running?.awakeAt;
  useEffect(() => {
    awakeRef.current = { awake: isAwake, ...(awakeSince === undefined ? {} : { awakeAt: awakeSince }) };
  });
  const jobId = running?.jobId;
  const startedAt = running?.startedAt;
  const request = running?.request;

  // Poll while running. Unmounting stops polling, never the job.
  useEffect(() => {
    if (jobId === undefined || startedAt === undefined || request === undefined) return undefined;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let polled = false;
    const tick = async (): Promise<void> => {
      if (!live) return;
      const elapsed = now() - startedAt;
      const { awake, awakeAt } = awakeRef.current;
      if (awakeAt === undefined && elapsed >= TIMEOUT_MS) {
        dispatch({ type: "fail", code: "upstream", message: "The forge took longer than five minutes.", request });
        return;
      }
      // A resumed job remembered awake polls once for its rig before its tail can settle it.
      if (awakeAt !== undefined && now() - awakeAt >= TAIL_TIMEOUT_MS && (awake || polled)) {
        dispatch({ type: "settle", message: "The forge took longer than five minutes." });
        return;
      }
      try {
        polled = true;
        const view = await clientRef.current.poll(jobId);
        if (!live) return;
        failures = 0;
        dispatch({ type: "view", view, at: now() });
        if (view.status === "done" || view.status === "failed") return;
      } catch (error) {
        if (!live) return;
        const e = error instanceof ForgeError ? error : new ForgeError("upstream", "The forge could not be reached.");
        failures += 1;
        if (e.code === "bad_input" || failures >= MAX_POLL_FAILURES) {
          dispatch({ type: "fail", code: e.code, message: e.message, request });
          return;
        }
      }
      timer = setTimeout(() => void tick(), pollDelay(now() - startedAt));
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [jobId, startedAt, request]);

  // The elapsed-time readout: one tick a second while running.
  useEffect(() => {
    if (jobId === undefined) return undefined;
    setClock(now());
    const timer = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(timer);
  }, [jobId]);

  // Remember the running job; forget it once it ends.
  useEffect(() => {
    if (state.phase === "running") {
      writeStoredJob(storage, { jobId: state.jobId, startedAt: state.startedAt, request: state.request, ...(state.awakeAt === undefined ? {} : { awakeAt: state.awakeAt }) });
    }
    else if (state.phase === "done" || state.phase === "failed") writeStoredJob(storage, undefined);
  }, [state, storage]);

  const start = useCallback(
    (req: ForgeRequest) => {
      if (state.phase === "running" || starting) return;
      setStarting(true);
      void (async () => {
        try {
          const { jobId: id } = await clientRef.current.start(req);
          dispatch({ type: "start", jobId: id, request: req, at: now() });
        } catch (error) {
          const e = error instanceof ForgeError ? error : new ForgeError("upstream", "The forge could not be reached.");
          dispatch({ type: "fail", code: e.code, message: e.message, request: req });
        } finally {
          setStarting(false);
        }
      })();
    },
    [state.phase, starting, now],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { state, elapsedMs: running === undefined ? 0 : Math.max(0, clock - running.startedAt), starting, start, reset };
}
