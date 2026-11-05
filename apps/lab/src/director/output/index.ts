// Output arm registry: one entry per OutputArmId, one file per arm (O0 o0.ts, O1 o1.ts).
import type { OutputArm, OutputArmId } from "../../contract.js";
import { createO0 } from "./o0.js";
import { createO1 } from "./o1.js";
import type { OutputArmFactory, OutputContext } from "./types.js";

export type { OutputArmFactory, OutputContext } from "./types.js";

export const OUTPUT_ARMS: Readonly<Record<OutputArmId, OutputArmFactory>> = {
  O0: createO0,
  O1: createO1,
};

export function createOutputArm(id: OutputArmId, ctx: OutputContext): OutputArm {
  return OUTPUT_ARMS[id](ctx);
}
