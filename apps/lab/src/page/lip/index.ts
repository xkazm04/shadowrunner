// Lip driver registry: one entry per LipArmId, one file per arm. WP3 replaces a `notBuilt` line
// with its factory (e.g. `L1: createL1,` importing from "./l1.js").
import type { LipArmId, LipDriver } from "../../contract.js";
import type { LipContext, LipDriverFactory } from "../types.js";
import { createL0 } from "./l0.js";
import { createL1 } from "./l1.js";
import { createL2 } from "./l2.js";

/** Every lip slot is built; kept for the next arm id. */
export function notBuilt(id: LipArmId, what: string): LipDriverFactory {
  return () => {
    throw new Error(`Lip arm ${id} is not built yet: it is ${what}. Run with lip L0, or add apps/lab/src/page/lip/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const LIP_DRIVERS: Readonly<Record<LipArmId, LipDriverFactory>> = {
  L0: createL0,
  L1: createL1,
  L2: createL2,
};

export function createLipDriver(id: LipArmId, ctx: LipContext): LipDriver {
  return LIP_DRIVERS[id](ctx);
}
