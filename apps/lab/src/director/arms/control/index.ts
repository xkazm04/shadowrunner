// Control arm registry: one entry per ControlArmId, one file per arm. WP2 replaces a `notBuilt`
// line with its factory (e.g. `C1: createC1,` importing from "./c1.js"); nothing else changes.
import type { ControlArm, ControlArmId } from "../../../contract.js";
import { createC0 } from "./c0.js";
import type { ControlArmFactory, ControlContext } from "./types.js";

export type { ControlArmFactory, ControlContext, ControlEvent, ControlUsage } from "./types.js";

function notBuilt(id: ControlArmId, what: string): ControlArmFactory {
  return () => {
    throw new Error(`Control arm ${id} is not built yet: it is ${what}. Run with control C0, or add apps/lab/src/director/arms/control/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const CONTROL_ARMS: Readonly<Record<ControlArmId, ControlArmFactory>> = {
  C0: createC0,
  C1: notBuilt("C1", "WP2's tool-call control arm"),
  C2: notBuilt("C2", "WP2's second control arm"),
};

export function createControlArm(id: ControlArmId, ctx: ControlContext): ControlArm {
  return CONTROL_ARMS[id](ctx);
}
