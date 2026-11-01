import { describe, expect, it, vi } from "vitest";
import type { Fetcher } from "../app/plane";
import { codeForStatus, createHttpForgeClient, errorFromBody, ForgeError, FORGE_URL, readJobView } from "./forgeClient";
import { testRig } from "./testFixtures";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fetcherOf(...responses: (Response | Error)[]): Fetcher & { calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return Object.assign(fn, { calls });
}

async function rejection(p: Promise<unknown>): Promise<ForgeError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ForgeError) return e;
    throw e;
  }
  throw new Error("expected a ForgeError");
}

describe("HTTP forge client: start", () => {
  it("POSTs the request as JSON to /api/forge and returns the job id", async () => {
    const f = fetcherOf(json(202, { jobId: "job_1" }));
    const client = createHttpForgeClient(f);
    await expect(client.start({ mode: "prompt", prompt: "a lantern for a head" })).resolves.toEqual({ jobId: "job_1" });
    const [url, init] = f.calls[0] ?? [];
    expect(url).toBe(FORGE_URL);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ mode: "prompt", prompt: "a lantern for a head" }));
  });

  it("turns { error: { code, message } } into a ForgeError with that code", async () => {
    const client = createHttpForgeClient(fetcherOf(json(429, { error: { code: "quota", message: "Spent." } })));
    const e = await rejection(client.start({ mode: "prompt", prompt: "x".repeat(20) }));
    expect(e.code).toBe("quota");
    expect(e.message).toBe("Spent.");
  });

  it("falls back on the HTTP status when the body names no code", async () => {
    const client = createHttpForgeClient(fetcherOf(new Response("<html>", { status: 413 })));
    expect((await rejection(client.start({ mode: "image", imageBase64: "AAAA" }))).code).toBe("bad_input");
  });

  it("makes a network fault upstream", async () => {
    const client = createHttpForgeClient(fetcherOf(new TypeError("offline")));
    expect((await rejection(client.start({ mode: "prompt", prompt: "x".repeat(20) }))).code).toBe("upstream");
  });

  it("refuses a 202 without a job id", async () => {
    const client = createHttpForgeClient(fetcherOf(json(202, {})));
    expect((await rejection(client.start({ mode: "prompt", prompt: "x".repeat(20) }))).code).toBe("upstream");
  });
});

describe("HTTP forge client: poll", () => {
  it("GETs /api/forge/:jobId and returns the checked view", async () => {
    const rig = testRig();
    const f = fetcherOf(json(200, { jobId: "j/1", status: "done", plane: "live", rig, assets: { "head.png": "https://x/head.png" } }));
    const view = await createHttpForgeClient(f).poll("j/1");
    expect(f.calls[0]?.[0]).toBe(`${FORGE_URL}/j%2F1`);
    expect(view.status).toBe("done");
    expect(view.rig?.id).toBe(rig.id);
  });

  it("passes a failed job through with its error", async () => {
    const f = fetcherOf(json(200, { jobId: "j", status: "failed", plane: "live", error: { code: "refused_likeness", message: "No." } }));
    expect((await createHttpForgeClient(f).poll("j")).error).toEqual({ code: "refused_likeness", message: "No." });
  });

  it("makes an unreadable view upstream", async () => {
    const f = fetcherOf(json(200, { jobId: "j", status: "melting", plane: "live" }));
    expect((await rejection(createHttpForgeClient(f).poll("j"))).code).toBe("upstream");
  });

  it("maps a 404 for an unknown job to bad_input", async () => {
    const f = fetcherOf(json(404, { error: { code: "bad_input", message: "No such forge job." } }));
    expect((await rejection(createHttpForgeClient(f).poll("gone"))).code).toBe("bad_input");
  });
});

describe("readJobView", () => {
  it("keeps only present optional fields (never null)", () => {
    const view = readJobView({ jobId: "j", status: "queued", plane: "replay" });
    expect(view).toEqual({ jobId: "j", status: "queued", plane: "replay" });
  });

  it("rejects an invalid rig, a null field, a wrong plane and non-string assets", () => {
    expect(readJobView({ jobId: "j", status: "done", plane: "live", rig: { version: 2 } })).toBeUndefined();
    expect(readJobView({ jobId: "j", status: "done", plane: "live", portraitUrl: null })).toBeUndefined();
    expect(readJobView({ jobId: "j", status: "done", plane: "both" })).toBeUndefined();
    expect(readJobView({ jobId: "j", status: "done", plane: "live", assets: { a: 1 } })).toBeUndefined();
  });

  it("maps HTTP statuses without a body code", () => {
    expect(codeForStatus(429)).toBe("quota");
    expect(codeForStatus(400)).toBe("bad_input");
    expect(codeForStatus(500)).toBe("upstream");
    expect(errorFromBody({ error: { code: "nope" } }, 502).code).toBe("upstream");
  });
});
