// Lip driver registry: one entry per LipArmId, one file per arm. WP3 replaces a `notBuilt` line
// with its factory (e.g. `L1: createL1,` importing from "./l1.js").
import type { LipArmId, LipDriver } from "../../contract.js";
import type { LipContext, LipDriverFactory } from "../types.js";
import { createL0 } from "./l0.js";

function notBuilt(id: LipArmId, what: string): LipDriverFactory {
  return () => {
    throw new Error(`Lip arm ${id} is not built yet: it is ${what}. Run with lip L0, or add apps/lab/src/page/lip/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const LIP_DRIVERS: Readonly<Record<LipArmId, LipDriverFactory>> = {
  L0: createL0,
  L1: notBuilt("L1", "WP3's viseme lip driver"),
  L2: notBuilt("L2", "WP3's second lip driver"),
};

export function createLipDriver(id: LipArmId, ctx: LipContext): LipDriver {
  return LIP_DRIVERS[id](ctx);
}
