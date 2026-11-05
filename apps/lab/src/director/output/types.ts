// What an output arm factory receives. One file per arm (o0.ts, o1.ts); index.ts maps ids.
import type { OutputArm } from "../../contract.js";
import type { StageServer } from "../stage/server.js";
import type { Stage } from "../stage/browser.js";

export interface OutputContext {
  runId: string;
  headless: boolean;
  server: StageServer;
  /** Opens the stage page in a browser (stage/browser.ts launchStage, bound to this run). */
  launch(url: string): Promise<Stage>;
  /** Hand the opened stage to the director (CPU sampling, diagnostics). Call once per launch. */
  onStage(stage: Stage): void;
  log(line: string): void;
}

export type OutputArmFactory = (ctx: OutputContext) => OutputArm;
