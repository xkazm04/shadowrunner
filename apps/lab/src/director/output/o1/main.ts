// Entry: node --import ./apps/lab/src/hooks.mjs apps/lab/src/director/output/o1/main.ts loop <runId> [--times N] [--output O1]
import { loopCommand } from "./loop.js";

const [command, ...rest] = process.argv.slice(2);
const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
if (command !== "loop") {
  log("usage: o1/main.ts loop <runId> [--times N] [--output O0|O1]");
  process.exitCode = 1;
} else {
  loopCommand(rest, log).catch((error: unknown) => {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
