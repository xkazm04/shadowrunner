// Entry for the mouths command (see command.ts); the Director wires it into `pnpm lab`.
//   node --import ./apps/lab/src/hooks.mjs apps/lab/src/mouths/main.ts <character> [--placeholder]
import { mouthsCommand } from "./command.js";

mouthsCommand(process.argv.slice(2), (line) => console.log(line)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
