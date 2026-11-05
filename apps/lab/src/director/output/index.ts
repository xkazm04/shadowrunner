// Output arm registry: one entry per OutputArmId, one file per arm. WP4 replaces the O1 line with
// its factory (`O1: createO1,` importing from "./o1.js").
import type { OutputArm, OutputArmId } from "../../contract.js";
import { createO0 } from "./o0.js";
import type { OutputArmFactory, OutputContext } from "./types.js";

export type { OutputArmFactory, OutputContext } from "./types.js";

function notBuilt(id: OutputArmId, what: string): OutputArmFactory {
  return () => {
    throw new Error(`Output arm ${id} is not built yet: it is ${what}. Run with output O0, or add apps/lab/src/director/output/${id.toLowerCase()}.ts and register it here.`);
  };
}

export const OUTPUT_ARMS: Readonly<Record<OutputArmId, OutputArmFactory>> = {
  O0: createO0,
  O1: notBuilt("O1", "WP4's streamed output (run.flv / run.mp4)"),
};

export function createOutputArm(id: OutputArmId, ctx: OutputContext): OutputArm {
  return OUTPUT_ARMS[id](ctx);
}
