// Entry: node --import ./apps/lab/src/hooks.mjs apps/lab/src/overlord/main.ts --toml <shadowrunr.toml> [--seconds 125] [--seed 1031] [--headed]
import { overlordCommand } from "./run.js";

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
overlordCommand(process.argv.slice(2), log).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
