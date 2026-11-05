// Entry: node --import ./apps/lab/src/hooks.mjs apps/lab/src/board/main.ts --pairs <runA>:<runB>,... [--clip 20] [--seed n]
import { boardCommand } from "./board.js";

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
boardCommand(process.argv.slice(2), log).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
