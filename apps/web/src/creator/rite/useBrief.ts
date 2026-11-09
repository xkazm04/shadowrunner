// The handshake's state (cast-forge requirement 4.3): ask for a brief, hold the streamer's edits,
// ask again. Only the answer to the latest ask lands; an older one that arrives late is dropped.
// The edited brief is kept as typed; the page checks it with `parseBrief` before "Draw it".
import type { CastMatchNote } from "@sr/forge/brief";
import type { CharacterBrief, ForgeErrorCode } from "@sr/forge/wire";
import { useCallback, useRef, useState } from "react";
import type { BriefClient } from "../briefClient";
import { ForgeError } from "../forgeClient";

export type BriefState =
  | { phase: "idle" }
  | { phase: "asking"; request: string }
  /** `match` (replay only): which recording was chosen for the words, as answered; edits never change it. */
  | { phase: "ready"; request: string; brief: CharacterBrief; plane: "replay" | "live"; match?: CastMatchNote }
  | { phase: "failed"; request: string; code: ForgeErrorCode; message: string };

export interface UseBrief {
  state: BriefState;
  ask(request: string): void;
  edit(brief: CharacterBrief): void;
  reset(): void;
}

export function useBrief(client: BriefClient): UseBrief {
  const [state, setState] = useState<BriefState>({ phase: "idle" });
  const latest = useRef(0);
  const ask = useCallback(
    (request: string) => {
      const n = (latest.current += 1);
      setState({ phase: "asking", request });
      client.brief(request).then(
        (answer) => {
          if (latest.current !== n) return;
          const match = answer.plane === "replay" ? answer.match : undefined;
          setState({ phase: "ready", request, brief: answer.brief, plane: answer.plane, ...(match === undefined ? {} : { match }) });
        },
        (err: unknown) => {
          if (latest.current !== n) return;
          const code = err instanceof ForgeError ? err.code : "upstream";
          setState({ phase: "failed", request, code, message: err instanceof ForgeError ? err.message : "The brief writer stopped answering." });
        },
      );
    },
    [client],
  );
  const edit = useCallback((brief: CharacterBrief) => setState((s) => (s.phase === "ready" ? { ...s, brief } : s)), []);
  const reset = useCallback(() => {
    latest.current += 1;
    setState({ phase: "idle" });
  }, []);
  return { state, ask, edit, reset };
}
