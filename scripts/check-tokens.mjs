// Every `var(--sr-NAME)` in a CSS Module must name a role in packages/theme/roles.json (tech.md:
// components consume role tokens only). Stylelint only checks that a value is *a* var(), so an
// undefined token such as `--sr-radius-2` resolves to nothing at runtime and slips through. Part
// of `pnpm lint`.
//   node scripts/check-tokens.mjs [dir-or-file ...]   (default: apps packages)
// Exit 0: every token is a role. Exit 1: at least one unknown token (file:line and NAME named).
// Exit 2: zero CSS Modules scanned or roles.json unreadable, so a wrong path can never pass.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES_FILE = join(ROOT, "packages", "theme", "roles.json");
const MODULE_CSS = /\.module\.css$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const TOKEN = /var\(\s*--sr-([A-Za-z0-9_-]+)/g;

function loadRoles() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ROLES_FILE, "utf8"));
  } catch (err) {
    console.error(`check-tokens: cannot read ${relative(ROOT, ROLES_FILE)}: ${err.message}`);
    process.exit(2);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((r) => typeof r === "string")) {
    console.error(`check-tokens: ${relative(ROOT, ROLES_FILE)} must be a non-empty array of role names.`);
    process.exit(2);
  }
  return new Set(parsed);
}

function* walk(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    if (MODULE_CSS.test(path)) yield path;
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(child);
    } else if (entry.isFile() && MODULE_CSS.test(entry.name)) {
      yield child;
    }
  }
}

/** Blank out comments but keep their newlines, so line numbers stay true. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

const roles = loadRoles();
const targets = process.argv.slice(2);
let scanned = 0;
let unknown = 0;
for (const target of targets.length > 0 ? targets : ["apps", "packages"]) {
  for (const file of walk(target)) {
    scanned += 1;
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const [, name] of line.matchAll(TOKEN)) {
        if (roles.has(name)) continue;
        unknown += 1;
        const where = relative(process.cwd(), file).replaceAll("\\", "/");
        console.error(`check-tokens: ${where}:${i + 1} uses --sr-${name}, which is not a role in packages/theme/roles.json.`);
      }
    });
  }
}

if (scanned === 0) {
  console.error("check-tokens: scanned 0 CSS Modules - check the paths; refusing to pass.");
  process.exit(2);
}
if (unknown > 0) process.exit(1);
console.log(`check-tokens: ${scanned} CSS Modules use role tokens only.`);
