// Runs the given command on the saved file(s) only once the pnpm workspace exists (M0 task 1 creates it).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readEvent, filesFrom } from "./_event.mjs";
if (!existsSync("pnpm-workspace.yaml") || !existsSync("node_modules")) process.exit(0);
const [cmd, ...args] = process.argv.slice(2).filter((a) => !existsSync(a));
const files = filesFrom(readEvent());
if (!files.length) process.exit(0);
const r = spawnSync(cmd, [...args, ...files], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
