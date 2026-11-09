// m0-spine task 8: the generated config.json routes and crons (scripts/vercel-config.mjs).
// `resolve` below is a small model of Vercel's legacy route walk for this table: the filesystem
// phase first (static files and functions by exact name), then the routes in order.
import { describe, expect, it } from "vitest";
import { CRON_SCHEDULE, dynamicRoute, functionName, IMMUTABLE, outputConfig, REVALIDATE } from "./vercel-config.mjs";

const FILES = [
  "api/cron/forge-gc.ts",
  "api/engine/reply.ts",
  "api/forge/[jobId].ts",
  "api/forge/[jobId]/faces.ts",
  "api/forge/drafts/[batchId].ts",
  "api/forge/drafts/index.ts",
  "api/forge/index.ts",
  "api/health.ts",
  "api/voice.ts",
];
const STATIC_FILES = new Set([
  "/index.html",
  "/assets/app.js",
  "/replay/shows/malakor-night/b00.m4a",
  "/replay/forge/malakor/head.png",
  "/packs/moth-widow.srpack",
  "/packs/index.json",
  "/embed/sr-avatar.js",
]);

function resolve(config, path, files = FILES) {
  const functions = new Set(files.map((f) => `/${functionName(f)}`));
  const exists = (p) => STATIC_FILES.has(p) || functions.has(p);
  const target = (p) => (functions.has(p.split("?")[0]) ? { fn: p } : { file: p });
  let filesystem = false;
  for (const route of config.routes) {
    if (route.continue === true) continue; // header-only routes (CORS) never decide the target
    if (route.handle === "filesystem") {
      filesystem = true;
      if (exists(path)) return target(path);
      continue;
    }
    expect(filesystem).toBe(true);
    const match = new RegExp(route.src).exec(path);
    if (!match) continue;
    if (route.status) return { status: route.status };
    const dest = route.dest.replace(/\$(\d+)/g, (_, i) => match[Number(i)]);
    if (route.check && !exists(dest.split("?")[0])) continue;
    return target(dest);
  }
  return { status: 404 };
}

/** The response headers Vercel would set for `path`: every matching header route, then the 404 route's own (later wins). */
function headersOf(config, path) {
  const out = {};
  const decided = resolve(config, path);
  for (const route of config.routes) {
    if (route.headers === undefined || !new RegExp(route.src).test(path)) continue;
    if (route.continue === true || (route.status !== undefined && route.status === decided.status)) Object.assign(out, route.headers);
  }
  return out;
}

describe("vercel-output config.json", () => {
  const config = outputConfig(FILES);

  it("is Build Output API v3 with the filesystem phase first (after header-only routes) and the SPA fallback last", () => {
    expect(config.version).toBe(3);
    const firstDecision = config.routes.findIndex((r) => r.continue !== true);
    expect(config.routes.slice(0, firstDecision).every((r) => r.headers !== undefined)).toBe(true);
    expect(config.routes[firstDecision]).toEqual({ handle: "filesystem" });
    expect(config.routes.at(-1)).toEqual({ src: "^/(.*)$", dest: "/index.html" });
    const apiNotFound = config.routes.findIndex((r) => r.src === "^/api(?:/.*)?$");
    const dynamic = config.routes.findIndex((r) => r.dest?.startsWith("/api/forge/[jobId]"));
    expect(dynamic).toBeGreaterThan(0);
    expect(apiNotFound).toBeGreaterThan(dynamic);
  });

  it("routes every function, the dynamic job id and the static replay files", () => {
    expect(resolve(config, "/api/health")).toEqual({ fn: "/api/health" });
    expect(resolve(config, "/api/forge")).toEqual({ fn: "/api/forge" });
    expect(resolve(config, "/api/forge/replay_malakor_lx3k9a")).toEqual({ fn: "/api/forge/[jobId]?jobId=replay_malakor_lx3k9a" });
    expect(resolve(config, "/api/forge/abc/")).toEqual({ fn: "/api/forge/[jobId]?jobId=abc" });
    // forge-creator L2: the casting batch and its polls, never taken for a forge job id.
    expect(resolve(config, "/api/forge/drafts")).toEqual({ fn: "/api/forge/drafts" });
    expect(resolve(config, "/api/forge/drafts/replaycast_0p_1_a~b~c")).toEqual({ fn: "/api/forge/drafts/[batchId]?batchId=replaycast_0p_1_a~b~c" });
    // forge-creator S2: repaint one face of a job.
    expect(resolve(config, "/api/forge/0123456789abcdef0123456789abcdef/faces")).toEqual({ fn: "/api/forge/[jobId]/faces?jobId=0123456789abcdef0123456789abcdef" });
    expect(resolve(config, "/api/engine/reply")).toEqual({ fn: "/api/engine/reply" });
    expect(resolve(config, "/api/voice")).toEqual({ fn: "/api/voice" });
    expect(resolve(config, "/api/cron/forge-gc")).toEqual({ fn: "/api/cron/forge-gc" });
    expect(resolve(config, "/replay/shows/malakor-night/b00.m4a")).toEqual({ file: "/replay/shows/malakor-night/b00.m4a" });
    expect(resolve(config, "/replay/forge/malakor/head.png")).toEqual({ file: "/replay/forge/malakor/head.png" });
  });

  it("answers 404 for unknown /api and /replay paths, and the SPA for everything else", () => {
    expect(resolve(config, "/api/nope")).toEqual({ status: 404 });
    expect(resolve(config, "/api/forge/a/b")).toEqual({ status: 404 });
    expect(resolve(config, "/api")).toEqual({ status: 404 });
    expect(resolve(config, "/replay/shows/missing.m4a")).toEqual({ status: 404 });
    expect(resolve(config, "/packs/missing.srpack")).toEqual({ status: 404 });
    expect(resolve(config, "/embed/missing.js")).toEqual({ status: 404 });
    expect(resolve(config, "/assets/stale-chunk-0ld.js")).toEqual({ status: 404 });
    expect(resolve(config, "/embed")).toEqual({ file: "/index.html" });
    expect(resolve(config, "/")).toEqual({ file: "/index.html" });
    expect(resolve(config, "/creator/forge")).toEqual({ file: "/index.html" });
    expect(resolve(config, "/assets/app.js")).toEqual({ file: "/assets/app.js" });
  });

  it("registers api/cron/forge-gc as a daily cron, and nothing else", () => {
    expect(config.crons).toEqual([{ path: "/api/cron/forge-gc", schedule: CRON_SCHEDULE }]);
    expect(CRON_SCHEDULE).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(outputConfig(["api/health.ts"])).not.toHaveProperty("crons");
  });

  it("handles any [param] file generically, specific routes before catch-alls", () => {
    expect(dynamicRoute("api/a/[x]/b/[y]")).toEqual({ src: "^/api/a/([^/]+)/b/([^/]+)/?$", dest: "/api/a/[x]/b/[y]?x=$1&y=$2", check: true });
    const files = ["api/files/[...path].ts", "api/files/[id]/meta.ts", "api/files/[id].ts"];
    const generic = outputConfig(files);
    expect(resolve(generic, "/api/files/7/meta", files)).toEqual({ fn: "/api/files/[id]/meta?id=7" });
    expect(resolve(generic, "/api/files/7", files)).toEqual({ fn: "/api/files/[id]?id=7" });
    expect(resolve(generic, "/api/files/a/b/c", files)).toEqual({ fn: "/api/files/[...path]?path=a/b/c" });
  });

  it("lets other sites fetch the embed script and the packs (CORS), before any routing decision", () => {
    const cors = config.routes.find((r) => r.headers?.["Access-Control-Allow-Origin"] !== undefined);
    expect(cors).toEqual({ src: "^/(?:embed|packs)/.+$", headers: { "Access-Control-Allow-Origin": "*" }, continue: true });
    for (const path of ["/embed/sr-avatar.js", "/packs/moth-widow.srpack", "/packs/index.json"]) expect(headersOf(config, path)["Access-Control-Allow-Origin"]).toBe("*");
    for (const path of ["/embed", "/", "/api/voice", "/replay/forge/malakor/head.png"]) expect(headersOf(config, path)).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("caches hashed assets for a year, revalidates packs, replay and embed files, and never caches a miss", () => {
    expect(IMMUTABLE).toBe("public, max-age=31536000, immutable");
    expect(REVALIDATE).toBe("public, max-age=3600, stale-while-revalidate=86400");
    expect(headersOf(config, "/assets/app.js")).toEqual({ "Cache-Control": IMMUTABLE });
    for (const path of ["/replay/shows/malakor-night/b00.m4a", "/replay/forge/malakor/head.png"]) expect(headersOf(config, path)).toEqual({ "Cache-Control": REVALIDATE });
    for (const path of ["/packs/moth-widow.srpack", "/embed/sr-avatar.js"]) expect(headersOf(config, path)).toEqual({ "Cache-Control": REVALIDATE, "Access-Control-Allow-Origin": "*" });
    for (const path of ["/assets/stale-chunk-0ld.js", "/replay/shows/missing.m4a", "/packs/missing.srpack", "/embed/missing.js"]) {
      expect(headersOf(config, path)["Cache-Control"], path).toBe("no-store");
    }
    // Pages and functions keep Vercel's defaults (HTML revalidates on every load; functions set their own).
    for (const path of ["/", "/embed", "/creator/forge", "/api/voice", "/api/nope"]) expect(headersOf(config, path), path).toEqual({});
  });

  it("refuses two files that answer the same path", () => {
    expect(() => outputConfig(["api/forge.ts", "api/forge/index.ts"])).toThrow(/two files answer \/api\/forge/);
  });
});
