// "Look around" on the Face tab (face-control "UX/UI spec"): while it is on, the glass's gaze
// cycles chat -> content -> host so the profile's gaze range and habits can be seen. Each target
// is held for LOOK_DWELL_MS times its habit weight (at least LOOK_MIN_MS); a target whose habit is
// 0 is skipped, and with every habit at 0 the face keeps to the host. Under reduced motion (the
// viewer's setting or the page's motion toggle) nothing cycles: the gaze stays undefined, so the
// player keeps its own default.
import type { Gaze } from "@sr/avatar";
import type { ResolvedFace } from "@sr/rig";
import { useEffect, useState } from "react";
import { reducedMotion } from "./usePick";

export const LOOK_ORDER: readonly Gaze[] = ["chat", "content", "host"];
export const LOOK_DWELL_MS = 2400;
export const LOOK_MIN_MS = 600;

/** The targets to visit, each with how long to hold it; empty when every habit is 0. */
export function lookPlan(habits: ResolvedFace["gaze"]["habits"]): { gaze: Gaze; ms: number }[] {
  return LOOK_ORDER.filter((g) => habits[g] > 0).map((gaze) => ({ gaze, ms: Math.max(LOOK_MIN_MS, Math.round(LOOK_DWELL_MS * habits[gaze])) }));
}

/** The gaze the glass is given now: undefined when off or under reduced motion. */
export function useLookAround(on: boolean, habits: ResolvedFace["gaze"]["habits"]): Gaze | undefined {
  const [at, setAt] = useState(0);
  const key = `${habits.chat}/${habits.content}/${habits.host}`;
  const active = on && !reducedMotion();
  const plan = lookPlan(habits);
  const step = plan.length === 0 ? undefined : plan[at % plan.length];
  useEffect(() => {
    if (!active || step === undefined || plan.length < 2) return undefined;
    const timer = setTimeout(() => setAt((n) => n + 1), step.ms);
    return () => clearTimeout(timer);
    // `key` stands for the habits: a new plan restarts the hold.
  }, [active, at, key, step?.ms, plan.length]);
  if (!active) return undefined;
  return step?.gaze ?? "host";
}
