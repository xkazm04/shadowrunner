// Entry: node --import ./apps/lab/src/hooks.mjs apps/lab/src/measure/main.ts <file> [--roi x,y,w,h] [--run <runId>]
//        node --import ./apps/lab/src/hooks.mjs apps/lab/src/measure/main.ts synth <out.flv|out.webm> [--offset <ms>]
import { measureCommand } from "./measure.js";
import { synthCommand } from "./synthCommand.js";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
(argv[0] === "synth" ? synthCommand(argv.slice(1), log) : measureCommand(argv, log)).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
