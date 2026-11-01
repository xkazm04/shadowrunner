// Emits dist/<theme>.css for every themes/<theme>.json (requirement 2.2). Fails, naming the role,
// if a theme leaves a role unbound or points at a missing scale step.
// Run via `pnpm --filter @sr/theme build` (Node type stripping loads the TypeScript sources).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTokens } from "./src/load.ts";
import { resolveTheme, themeCss } from "./src/tokens.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "dist");

let tokens;
try {
  tokens = loadTokens(HERE);
} catch (err) {
  console.error(`theme: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const problems = [];
const sheets = [];
for (const [name, theme] of tokens.themes) {
  const resolved = resolveTheme(tokens.roles, tokens.scales, theme, name);
  problems.push(...resolved.problems);
  sheets.push([name, themeCss(name, resolved.values)]);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`theme: ${problem}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [name, css] of sheets) writeFileSync(join(OUT, `${name}.css`), css);
console.log(`theme: wrote ${sheets.map(([name]) => `dist/${name}.css`).join(", ")} (${tokens.roles.length} roles)`);
