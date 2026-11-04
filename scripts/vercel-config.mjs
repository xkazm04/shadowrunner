// The pure half of scripts/vercel-output.mjs (m0-spine task 8): from the list of function files
// under api/, decide each function's folder, its routes, and its cron entry, and write the
// Build Output API v3 `config.json`. No file system access here, so vitest can check it
// (scripts/vercel-config.test.mjs).

/** Daily, at a quiet hour (UTC). Vercel Hobby allows daily crons. */
export const CRON_SCHEDULE = "0 4 * * *";

/** Functions under this folder are crons, called by Vercel Cron with `Bearer <CRON_SECRET>`. */
const CRON_DIR = "api/cron/";

const PARAM = /^\[(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)\]$/;

/**
 * `api/forge/index.ts` -> `api/forge`, `api/forge/[jobId].ts` -> `api/forge/[jobId]`.
 * The result is the function's folder under functions/ (without `.func`) and the path it answers.
 * Takes a posix path relative to the repository root.
 */
export function functionName(file) {
  const name = file.replace(/\.ts$/, "");
  return name.endsWith("/index") ? name.slice(0, -"/index".length) : name;
}

/** True when a path segment is a `[param]` or `[...param]` placeholder. */
export function isDynamic(name) {
  return name.split("/").some((segment) => PARAM.test(segment));
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The rewrite for a dynamic function: `api/forge/[jobId]` matches `/api/forge/<one segment>` and
 * reaches the function as `/api/forge/[jobId]?jobId=<segment>`. `[...rest]` takes one or more
 * segments. `check: true` makes Vercel confirm the destination exists after the rewrite.
 */
export function dynamicRoute(name) {
  const params = [];
  const pattern = name
    .split("/")
    .map((segment) => {
      const match = PARAM.exec(segment);
      if (!match) return escapeRegex(segment);
      params.push(match[2]);
      return match[1] ? "(.+)" : "([^/]+)";
    })
    .join("/");
  const query = params.map((p, i) => `${p}=$${i + 1}`).join("&");
  return { src: `^/${pattern}/?$`, dest: `/${name}?${query}`, check: true };
}

/** A static (no placeholder) name ranks before a dynamic one; among dynamic ones, more literal segments first. */
function specificity(name) {
  const segments = name.split("/");
  const literal = segments.filter((s) => !PARAM.test(s)).length;
  const catchAll = segments.some((s) => /^\[\.\.\./.test(s)) ? 1 : 0;
  return [catchAll, -literal, -segments.length];
}

function bySpecificity(a, b) {
  const sa = specificity(a);
  const sb = specificity(b);
  for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sa[i] - sb[i];
  return a.localeCompare(b);
}

/**
 * The route table. Order matters:
 * 0. the embed script and the packs carry `Access-Control-Allow-Origin: *` (avatar-reach: other
 *    sites load `<sr-avatar>` and its pack cross-origin), then routing continues;
 * 1. `filesystem`: static files (the app, /replay/**) and functions by their exact name win;
 * 2. dynamic function rewrites, the most specific first;
 * 3. an unknown /api/* or a missing /replay/*, /packs/* or /embed/<file> is a 404 (/embed itself is a page) (never the SPA's HTML);
 * 4. every other path is the SPA's index.html (the client router owns it).
 */
export function routesFor(names) {
  const dynamic = names.filter(isDynamic).sort(bySpecificity);
  return [
    { src: "^/(?:embed|packs)/.+$", headers: { "Access-Control-Allow-Origin": "*" }, continue: true },
    { handle: "filesystem" },
    ...dynamic.map(dynamicRoute),
    { src: "^/api(?:/.*)?$", status: 404 },
    { src: "^/replay(?:/.*)?$", status: 404 },
    { src: "^/packs(?:/.*)?$", status: 404 },
    { src: "^/embed/.+$", status: 404 },
    { src: "^/(.*)$", dest: "/index.html" },
  ];
}

/** One daily cron per function under api/cron/. */
export function cronsFor(names) {
  return names
    .filter((name) => name.startsWith(CRON_DIR) && !isDynamic(name))
    .sort()
    .map((name) => ({ path: `/${name}`, schedule: CRON_SCHEDULE }));
}

/** The whole config.json object. Throws when two files map to one function name. */
export function outputConfig(files) {
  const names = files.map(functionName);
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`vercel-output: two files answer /${name}`);
    seen.add(name);
  }
  const crons = cronsFor(names);
  return { version: 3, routes: routesFor(names), ...(crons.length > 0 ? { crons } : {}) };
}
