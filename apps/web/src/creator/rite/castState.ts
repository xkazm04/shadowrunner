// The casting sheet's state machine (forge-creator L2). Pure: useCast.ts feeds it events. A brief
// is cast in batches: `start` asks for a fresh batch, `reroll` for the next one of the chain; each
// batch is polled until its view is "ready" (the sheet) or "failed". Rules:
// - views for another batch (a stale poll after a re-roll) are ignored;
// - a batch's status only moves forward (drafting < segmenting < cutting < ready); an older view
//   is ignored, and a view after a terminal one too;
// - a failure keeps the last sheet when there is one (a refused re-roll leaves the three on show,
//   with the message), so "None of these" never loses the candidates already drawn;
// - `back` returns to the brief from anywhere.
import type { CastStatus, CastView, CharacterBrief, ForgeErrorCode } from "@sr/forge/wire";

export type CastState =
  | { phase: "idle" }
  /** A batch is being asked for (no id yet) or drawn and cut (polling). */
  | { phase: "casting"; brief: CharacterBrief; batchId?: string; view?: CastView; previous?: CastView }
  | { phase: "ready"; brief: CharacterBrief; view: CastView }
  | { phase: "failed"; brief: CharacterBrief; code: ForgeErrorCode; message: string; view?: CastView };

export type CastEvent =
  | { type: "start"; brief: CharacterBrief }
  | { type: "reroll" }
  | { type: "batch"; batchId: string }
  | { type: "view"; view: CastView }
  | { type: "fail"; code: ForgeErrorCode; message: string }
  | { type: "back" };

export const CAST_IDLE: CastState = { phase: "idle" };

const ORDER: readonly CastStatus[] = ["drafting", "segmenting", "cutting", "ready", "failed"];
const rank = (s: CastStatus): number => ORDER.indexOf(s);

/** The sheet on show in a state (the last full view), if any. */
export function sheetOf(state: CastState): CastView | undefined {
  if (state.phase === "ready") return state.view;
  if (state.phase === "failed") return state.view;
  if (state.phase === "casting") return state.view ?? state.previous;
  return undefined;
}

export function castReducer(state: CastState, event: CastEvent): CastState {
  switch (event.type) {
    case "start":
      return { phase: "casting", brief: event.brief };
    case "back":
      return CAST_IDLE;
    case "reroll": {
      if (state.phase !== "ready" && state.phase !== "failed") return state;
      const sheet = sheetOf(state);
      if (sheet === undefined || sheet.rerollsLeft <= 0) return state;
      return { phase: "casting", brief: state.brief, previous: sheet };
    }
    case "batch":
      return state.phase === "casting" && state.batchId === undefined ? { ...state, batchId: event.batchId } : state;
    case "view": {
      if (state.phase !== "casting" || state.batchId !== event.view.batchId) return state;
      if (state.view !== undefined && rank(event.view.status) < rank(state.view.status)) return state;
      if (event.view.status === "ready") return { phase: "ready", brief: state.brief, view: event.view };
      if (event.view.status === "failed") {
        const error = event.view.error ?? { code: "upstream" as const, message: "The casting failed." };
        const keep = state.previous;
        return { phase: "failed", brief: state.brief, code: error.code, message: error.message, ...(keep === undefined ? {} : { view: keep }) };
      }
      return { ...state, view: event.view };
    }
    case "fail": {
      if (state.phase !== "casting") return state;
      const keep = state.previous;
      return { phase: "failed", brief: state.brief, code: event.code, message: event.message, ...(keep === undefined ? {} : { view: keep }) };
    }
  }
}

/** The batch to re-roll from in a state ("None of these"), when one may still be made. */
export function rerollFrom(state: CastState): string | undefined {
  const sheet = state.phase === "casting" ? state.previous : sheetOf(state);
  return sheet !== undefined && sheet.rerollsLeft > 0 ? sheet.batchId : undefined;
}
