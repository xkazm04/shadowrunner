// m0-spine task 8: the generated config.json routes and crons (scripts/vercel-config.mjs).
// `resolve` below is a small model of Vercel's legacy route walk for this table: the filesystem
// phase first (static files and functions by exact name), then the routes in order.
import { describe, expect, it } from "vitest";
import { CRON_SCHEDULE, dynamicRoute, functionName, outputConfig } from "./vercel-config.mjs";

const FILES = [
  "api/cron/forge-gc.ts",
  "api/engine/reply.ts",
  "api/forge/[jobId].ts",
  "api/forge/index.ts",
  "api/health.ts",
  "api/voice.ts",
];
const STATIC_FILES = new Set(["/index.html", "/assets/app.js", "/replay/shows/malakor-night/b00.wav", "/replay/forge/malakor/head.png"]);

function resolve(config, path, files = FILES) {
  const functions = new Set(files.map((f) => `/${functionName(f)}`));
  const exists = (p) => STATIC_FILES.has(p) || functions.has(p);
  const target = (p) => (functions.has(p.split("?")[0]) ? { fn: p } : { file: p });
  let filesystem = false;
  for (const route of config.routes) {
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

describe("vercel-output config.json", () => {
  const config = outputConfig(FILES);

  it("is Build Output API v3 with the filesystem phase first and the SPA fallback last", () => {
    expect(config.version).toBe(3);
    expect(config.routes[0]).toEqual({ handle: "filesystem" });
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
    expect(resolve(config, "/api/engine/reply")).toEqual({ fn: "/api/engine/reply" });
    expect(resolve(config, "/api/voice")).toEqual({ fn: "/api/voice" });
    expect(resolve(config, "/api/cron/forge-gc")).toEqual({ fn: "/api/cron/forge-gc" });
    expect(resolve(config, "/replay/shows/malakor-night/b00.wav")).toEqual({ file: "/replay/shows/malakor-night/b00.wav" });
    expect(resolve(config, "/replay/forge/malakor/head.png")).toEqual({ file: "/replay/forge/malakor/head.png" });
  });

  it("answers 404 for unknown /api and /replay paths, and the SPA for everything else", () => {
    expect(resolve(config, "/api/nope")).toEqual({ status: 404 });
    expect(resolve(config, "/api/forge/a/b")).toEqual({ status: 404 });
    expect(resolve(config, "/api")).toEqual({ status: 404 });
    expect(resolve(config, "/replay/shows/missing.wav")).toEqual({ status: 404 });
    expect(resolve(config, "/packs/missing.srpack")).toEqual({ status: 404 });
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

  it("refuses two files that answer the same path", () => {
    expect(() => outputConfig(["api/forge.ts", "api/forge/index.ts"])).toThrow(/two files answer \/api\/forge/);
  });
});
