// The casting sheet as React state (forge-creator L2): asks the cast client for a batch (fresh, or a
// re-roll of the sheet on show) from the click itself, never from an effect (StrictMode runs effects
// twice, and a live batch counts a forge use); polls it every CAST_POLL_MS until it is ready or
// failed, and folds every answer through `castReducer`. Polling stops on unmount and on
// "Back to the brief"; three failed polls in a row, or CAST_TIMEOUT_MS, end the batch as `upstream`.
import type { CharacterBrief } from "@sr/forge/wire";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CastClient } from "../castClient";
import { ForgeError } from "../forgeClient";
import { CAST_IDLE, castReducer, rerollFrom, type CastState } from "./castState";

export const CAST_POLL_MS = 1500;
export const CAST_TIMEOUT_MS = 3 * 60_000;
const MAX_FAILURES = 3;

export interface Cast {
  state: CastState;
  start(brief: CharacterBrief): void;
  /** "None of these": the next batch of the chain, when re-rolls are left. */
  reroll(): void;
  /** "Back to the brief". */
  back(): void;
}

const asForgeError = (error: unknown): ForgeError => (error instanceof ForgeError ? error : new ForgeError("upstream", "The casting could not be reached."));

export function useCast(client: CastClient, now: () => number = Date.now): Cast {
  const [state, dispatch] = useReducer(castReducer, CAST_IDLE);
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  // Each ask has a number; an answer to an ask that "back" or a newer ask replaced is dropped.
  const ask = useRef(0);
  const draft = useCallback((brief: CharacterBrief, after: string | undefined) => {
    const n = ++ask.current;
    clientRef.current.draft(brief, after).then(
      ({ batchId }) => n === ask.current && dispatch({ type: "batch", batchId }),
      (error: unknown) => {
        const e = asForgeError(error);
        if (n === ask.current) dispatch({ type: "fail", code: e.code, message: e.message });
      },
    );
  }, []);

  // Poll the batch until it is ready or failed.
  const batchId = state.phase === "casting" ? state.batchId : undefined;
  useEffect(() => {
    if (batchId === undefined) return undefined;
    let live = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = now();
    const tick = async (): Promise<void> => {
      if (!live) return;
      if (now() - started >= CAST_TIMEOUT_MS) {
        dispatch({ type: "fail", code: "upstream", message: "The casting took too long." });
        return;
      }
      try {
        const view = await clientRef.current.poll(batchId);
        if (!live) return;
        failures = 0;
        dispatch({ type: "view", view });
        if (view.status === "ready" || view.status === "failed") return;
      } catch (error) {
        if (!live) return;
        const e = asForgeError(error);
        failures += 1;
        if (e.code === "bad_input" || failures >= MAX_FAILURES) {
          dispatch({ type: "fail", code: e.code, message: e.message });
          return;
        }
      }
      timer = setTimeout(() => void tick(), CAST_POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [batchId, now]);

  const start = useCallback(
    (b: CharacterBrief) => {
      dispatch({ type: "start", brief: b });
      draft(b, undefined);
    },
    [draft],
  );
  const reroll = useCallback(() => {
    const current = stateRef.current;
    const after = rerollFrom(current);
    if (after === undefined || (current.phase !== "ready" && current.phase !== "failed")) return;
    dispatch({ type: "reroll" });
    draft(current.brief, after);
  }, [draft]);
  const back = useCallback(() => {
    ask.current += 1;
    dispatch({ type: "back" });
  }, []);
  return { state, start, reroll, back };
}
