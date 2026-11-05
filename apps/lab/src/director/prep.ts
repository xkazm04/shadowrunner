// Before a run: the theme CSS and the cast packs the page loads are build outputs (never
// committed). Build them the way the root `dev` script does when they are missing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PACKS_DIR, REPO_ROOT, THEME_DIST } from "./paths.js";

/** `line` is a fixed command (no user input); a shell finds pnpm.cmd on Windows. */
function run(line: string, what: string): void {
  const result = spawnSync(line, { cwd: REPO_ROOT, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`${what} failed (\`${line}\` exited ${result.status ?? "by signal"}).`);
}

export function ensureStageAssets(character: string, log: (line: string) => void): void {
  if (!existsSync(join(THEME_DIST, "halloween.css"))) {
    log("prep: building @sr/theme (packages/theme/dist is missing)");
    run("pnpm --filter @sr/theme build", "Building @sr/theme");
  }
  const pack = join(PACKS_DIR, `${character}.srpack`);
  if (!existsSync(pack)) {
    log(`prep: building cast packs (${pack} is missing)`);
    run("node scripts/build-packs.mjs", "Building cast packs");
  }
  if (!existsSync(pack)) throw new Error(`Character "${character}" has no pack: ${pack} does not exist after building the cast packs.`);
}
