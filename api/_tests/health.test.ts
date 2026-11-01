// Lives under an underscore folder so Vercel does not deploy it as a function.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, health, version } from "../health.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("answers { plane, engine, version } on replay with no keys and no env at all", async () => {
    vi.stubEnv("SR_PLANE", undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ plane: "replay", engine: "scripted", version: "dev" });
  });

  it("reads SR_PLANE and the engine key presence from process.env", async () => {
    vi.stubEnv("SR_PLANE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-a-real-key");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    expect(await GET().json()).toEqual({ plane: "live", engine: "anthropic", version: "0123456" });
  });
});

describe("GET /api/health with x-sr-plane", () => {
  it("answers replay to a client that sends x-sr-plane: replay, even on a live deploy with a key", async () => {
    vi.stubEnv("SR_PLANE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-a-real-key");
    const req = new Request("https://sr.test/api/health", { headers: { "x-sr-plane": "replay" } });
    expect(await GET(req).json()).toMatchObject({ plane: "replay", engine: "scripted" });
  });

  it("cannot be talked into live by the header", async () => {
    vi.stubEnv("SR_PLANE", undefined);
    const req = new Request("https://sr.test/api/health", { headers: { "x-sr-plane": "live" } });
    expect(await GET(req).json()).toMatchObject({ plane: "replay", engine: "scripted" });
  });
});

describe("health", () => {
  it("has exactly plane, engine and version, and never echoes a secret", () => {
    // The prefix keeps a random key from colliding with a legitimate value such as "scripted".
    const secret = fc.string({ minLength: 8 }).map((s) => `sk-${s}`);
    fc.assert(
      fc.property(fc.constantFrom("replay", "live", "", "LIVE"), secret, secret, (srPlane, anthropic, gemini) => {
        const body = health({ SR_PLANE: srPlane, ANTHROPIC_API_KEY: anthropic, GEMINI_API_KEY: gemini });
        expect(Object.keys(body).sort()).toEqual(["engine", "plane", "version"]);
        const text = JSON.stringify(body);
        expect(text).not.toContain(JSON.stringify(anthropic).slice(1, -1));
        expect(text).not.toContain(JSON.stringify(gemini).slice(1, -1));
      }),
    );
  });
});

describe("version", () => {
  it("is the short commit on Vercel and dev elsewhere", () => {
    expect(version({ VERCEL_GIT_COMMIT_SHA: "fedcba9876543210" })).toBe("fedcba9");
    expect(version({ VERCEL_GIT_COMMIT_SHA: "  " })).toBe("dev");
    expect(version({})).toBe("dev");
  });
});
