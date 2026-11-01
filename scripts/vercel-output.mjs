// Writes the Vercel Build Output API v3 tree (m0-spine requirement 5.1). Run after `pnpm build`:
//   node scripts/vercel-output.mjs [outDir]   (default: .vercel/output, where Vercel looks)
// Why not zero-config: @vercel/node compiles api/*.ts file by file but leaves workspace packages
// as they are, and @sr/* export TypeScript source (`"exports": "./src/index.ts"`), so the deployed
// function fails with ERR_MODULE_NOT_FOUND. Here every function is bundled into one ESM file with
// its workspace imports inlined, and the static app is copied as is.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "api");
const STATIC = join(ROOT, "apps", "web", "dist");
const OUT = resolve(ROOT, process.argv[2] ?? ".vercel/output");
const RUNTIME = "nodejs22.x";

/** Vercel's rule: every api/**.ts is a function unless a path segment starts with `_` or `.`. */
function* functionEntries(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* functionEntries(path);
    else if (/\.ts$/.test(entry.name) && !/\.(d|test)\.ts$/.test(entry.name)) yield path;
  }
}

/** api/health.ts -> api/health (the route, and the .func folder under functions/). */
function routeOf(entry) {
  return relative(ROOT, entry).split(sep).join("/").replace(/\.ts$/, "");
}

async function bundle(entry, funcDir) {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "warn",
    publicDir: false,
    ssr: { target: "node", noExternal: true },
    build: {
      ssr: entry,
      outDir: funcDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      rolldownOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
    },
  });
  const config = { runtime: RUNTIME, handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: true };
  writeFileSync(join(funcDir, ".vc-config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

if (!existsSync(join(STATIC, "index.html"))) {
  console.error(`vercel-output: ${relative(ROOT, STATIC)}/index.html is missing; run \`pnpm build\` first`);
  process.exit(1);
}
const entries = [...functionEntries(API)];
if (entries.length === 0) {
  console.error("vercel-output: no functions found under api/");
  process.exit(2);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(STATIC, join(OUT, "static"), { recursive: true });
for (const entry of entries) {
  await bundle(entry, join(OUT, "functions", `${routeOf(entry)}.func`));
}
// Files and functions first; an unknown /api/* path is a 404, any other path is the SPA.
const routes = [
  { handle: "filesystem" },
  { src: "^/api(?:/.*)?$", status: 404 },
  { src: "^/(.*)$", dest: "/index.html" },
];
writeFileSync(join(OUT, "config.json"), `${JSON.stringify({ version: 3, routes }, null, 2)}\n`);
console.log(`vercel-output: ${relative(ROOT, OUT)} (static + ${entries.map(routeOf).join(", ")})`);
