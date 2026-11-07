// forge-creator C1, the replay twin of "wake after eyes, faces paint in". A recorded job's rig is
// final (eyes socketed, faces cut), but the recording keeps no trace of the faces arriving. On the
// replay plane a recorded job whose rig carries expression patches gets one synthetic `expressing`
// hold after its recorded steps (`withFacesStep`). It is awake from the first moment of that hold,
// with the rig stripped of every face (`rigWithFaces(rig, 0)`), and the six families arrive one per
// REPLAY_FACE_HOLD_MS in EXPRESSION_FAMILIES order, each bringing back exactly the patches the
// recording has for it; a family the recording has none for comes to "skipped" (procedural).
// A rig without patches keeps its recorded steps: awake is done. Pure; shared by the server's
// replay (api/_lib/forge-replay.ts) and the browser's (apps/web/src/creator/forgeClient.replay.ts).
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Rig } from "@sr/rig";
import type { ForgeStatus } from "./wire.js";

/** One family's simulated paint time on replay. */
export const REPLAY_FACE_HOLD_MS = 750;
/** The synthetic `expressing` hold: every family in turn. */
export const REPLAY_FACES_HOLD_MS = REPLAY_FACE_HOLD_MS * EXPRESSION_FAMILIES.length;

export interface ReplayHold {
  status: ForgeStatus;
  holdMs: number;
}

/** True when any layer of the rig carries an expression patch. */
export const hasFaces = (rig: Rig): boolean => rig.layers.some((l) => l.variants !== undefined && Object.keys(l.variants).length > 0);

/** The recorded steps with the synthetic `expressing` hold before "done", when the rig has faces and the steps lack one. */
export function withFacesStep(steps: readonly ReplayHold[], rig: Rig): ReplayHold[] {
  const out = steps.map((s) => ({ status: s.status, holdMs: s.holdMs }));
  const done = out.findIndex((s) => s.status === "done");
  if (!hasFaces(rig) || done < 0 || out.some((s) => s.status === "expressing")) return out;
  out.splice(done, 0, { status: "expressing", holdMs: REPLAY_FACES_HOLD_MS });
  return out;
}

/** How many families have arrived `elapsedMs` after the job's start (0 before `expressing`, all of them after). */
export function facesAt(steps: readonly ReplayHold[], elapsedMs: number): number {
  let start = 0;
  for (const step of steps) {
    if (step.status === "expressing") {
      const ms = Math.max(0, elapsedMs - start);
      return Math.min(EXPRESSION_FAMILIES.length, Math.floor(ms / REPLAY_FACE_HOLD_MS));
    }
    if (step.status === "done") break;
    start += step.holdMs;
  }
  return EXPRESSION_FAMILIES.length;
}

/** The rig with only the first `arrived` families' patches (in EXPRESSION_FAMILIES order); `variants` omitted when none is left. */
export function rigWithFaces(rig: Rig, arrived: number): Rig {
  const kept = new Set<string>(EXPRESSION_FAMILIES.slice(0, Math.max(0, arrived)));
  return {
    ...rig,
    layers: rig.layers.map((layer) => {
      if (layer.variants === undefined) return layer;
      const { variants, ...rest } = layer;
      const left = Object.fromEntries(Object.entries(variants).filter(([family]) => kept.has(family)));
      return Object.keys(left).length === 0 ? rest : { ...rest, variants: left };
    }),
  };
}

/** What each arrived family came to: "ok" when the recording has a patch for it, else "skipped". */
export function facesOutcomes(rig: Rig, arrived: number): Partial<Record<ExpressionFamily, "ok" | "skipped">> {
  const out: Partial<Record<ExpressionFamily, "ok" | "skipped">> = {};
  for (const family of EXPRESSION_FAMILIES.slice(0, Math.max(0, arrived))) {
    out[family] = rig.layers.some((l) => l.variants?.[family] !== undefined) ? "ok" : "skipped";
  }
  return out;
}

/** Every file the rig's expression patches name (patch images and their sockets). */
export function faceFiles(rig: Rig): Set<string> {
  return new Set(rig.layers.flatMap((l) => Object.values(l.variants ?? {}).flatMap((p) => [p.file, ...(p.socket === undefined ? [] : [p.socket])])));
}

/** `assets` without the patch files of families that have not arrived (those `rig` names but `shown` does not). */
export function assetsWithFaces(rig: Rig, shown: Rig, assets: Readonly<Record<string, string>>): Record<string, string> {
  const left = faceFiles(shown);
  const gone = new Set([...faceFiles(rig)].filter((f) => !left.has(f)));
  return Object.fromEntries(Object.entries(assets).filter(([file]) => !gone.has(file)));
}
