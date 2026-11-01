// 400-line cap for source files (tech.md). Part of `pnpm lint`.
//   node scripts/line-cap.mjs [dir ...]   (default: apps packages api)
// Exit 0: all files within the cap. Exit 1: at least one file over it (each is named).
// Exit 2: zero files scanned, so a wrong path or glob can never pass silently.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CAP = 400;
const EXTENSIONS = /\.(ts|tsx|css)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function* walk(dir) {
  if (!existsSync(dir)) return;
  if (statSync(dir).isFile()) {
    if (EXTENSIONS.test(dir)) yield dir;
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path);
    } else if (entry.isFile() && EXTENSIONS.test(entry.name)) {
      yield path;
    }
  }
}

/** Lines as an editor shows them: a trailing newline does not open an extra line. */
function countLines(text) {
  if (text.length === 0) return 0;
  const breaks = text.match(/\n/g)?.length ?? 0;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

const roots = process.argv.slice(2);
let scanned = 0;
let over = 0;
for (const root of roots.length > 0 ? roots : ["apps", "packages", "api"]) {
  for (const file of walk(root)) {
    scanned += 1;
    const lines = countLines(readFileSync(file, "utf8"));
    if (lines > CAP) {
      over += 1;
      console.error(`line-cap: ${relative(process.cwd(), file)} has ${lines} lines (cap ${CAP}). Split it by responsibility.`);
    }
  }
}

if (scanned === 0) {
  console.error("line-cap: scanned 0 files - check the paths; refusing to pass.");
  process.exit(2);
}
if (over > 0) process.exit(1);
console.log(`line-cap: ${scanned} files within ${CAP} lines.`);
