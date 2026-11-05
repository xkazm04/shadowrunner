// Control arm registry: one entry per ControlArmId, one file per arm. WP2 replaces a `notBuilt`
// line with its factory (e.g. `C1: createC1,` importing from "./c1.js"); nothing else changes.
import type { ControlArm, ControlArmId } from "../../../contract.js";
import { createC0 } from "./c0.js";
import { createC1 } from "./c1.js";
import { createC2 } from "./c2.js";
import type { ControlArmFactory, ControlContext } from "./types.js";

export type { ControlArmFactory, ControlContext, ControlEvent, ControlUsage } from "./types.js";

/** Every control slot is built; kept for the next arm id. */
export function notBuilt(id: ControlArmId, what: string): ControlArmFactory {
  return () => {
    throw new Error(`Control arm ${id} is not built yet: it is ${what}. Run with control C0, or add apps/lab/src/director/arms/control/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const CONTROL_ARMS: Readonly<Record<ControlArmId, ControlArmFactory>> = {
  C0: createC0,
  C1: createC1,
  C2: createC2,
};

export function createControlArm(id: ControlArmId, ctx: ControlContext): ControlArm {
  return CONTROL_ARMS[id](ctx);
}
