// cast-forge task 10 (requirement 4.3): the brief client. The http client posts {request} to
// /api/forge/brief and checks the answer with parseBrief; every failure is a ForgeError with a wire
// code. The replay twin reads the eight recorded contest briefs in the browser and never fetches.
// A brief started on the replay forge plays the cast member's recorded job when there is one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_URL, createHttpBriefClient, createReplayBriefClient, loadRecordedBriefs, readBriefResponse } from "./briefClient";
import { ForgeError } from "./forgeClient";
import { createReplayForgeClient, parseReplayJobId } from "./forgeClient.replay";
import { testBriefs, testJob } from "./testFixtures";

const [CARDIA, TALLY] = testBriefs();
if (CARDIA === undefined || TALLY === undefined) throw new Error("fixtures");

let fetches = 0;
beforeEach(() => {
  fetches = 0;
  vi.stubGlobal("fetch", () => {
    fetches += 1;
    throw new Error("network access in a test");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("http brief client", () => {
  it("posts the request and returns the checked brief", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createHttpBriefClient(async (url, init) => (calls.push({ url, ...(init === undefined ? {} : { init }) }), reply(200, { brief: TALLY, plane: "live" })()));
    expect(await client.brief("a census ghost")).toEqual({ brief: TALLY, plane: "live" });
    expect(calls[0]?.url).toBe(BRIEF_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ request: "a census ghost" });
  });

  it("an error body keeps its code; an unreadable answer or a fault is upstream", async () => {
    await expect(createHttpBriefClient(reply(429, { error: { code: "quota", message: "spent" } })).brief("x")).rejects.toMatchObject({ code: "quota" });
    await expect(createHttpBriefClient(reply(200, { brief: { ...TALLY, parts: [] }, plane: "live" })).brief("x")).rejects.toMatchObject({ code: "upstream" });
    await expect(
      createHttpBriefClient(async () => {
        throw new TypeError("offline");
      }).brief("x"),
    ).rejects.toBeInstanceOf(ForgeError);
  });

  it("readBriefResponse refuses a wrong plane or a brief that breaks a rule", () => {
    expect(readBriefResponse({ brief: TALLY, plane: "replay" })).toEqual({ brief: TALLY, plane: "replay" });
    expect(readBriefResponse({ brief: TALLY, plane: "elsewhere" })).toBeUndefined();
    expect(readBriefResponse({ brief: { ...TALLY, accent_hex: "green" }, plane: "live" })).toBeUndefined();
    expect(readBriefResponse(null)).toBeUndefined();
  });
});

describe("replay brief client", () => {
  it("reads the eight recorded briefs and answers a one-line request with its own, without a request", async () => {
    const briefs = await loadRecordedBriefs();
    expect(briefs).toHaveLength(8);
    const client = createReplayBriefClient();
    expect((await client.brief("A SPOOKY census guy  that counts everyone in chat")).brief.name).toBe("The Tallyman");
    const other = await client.brief("something nobody recorded");
    expect(other).toEqual({ brief: briefs[0], plane: "replay" });
    await expect(client.brief("  ")).rejects.toMatchObject({ code: "bad_input" });
    expect(fetches).toBe(0);
  });
});

describe("replay forge, mode brief", () => {
  it("starts the cast member's recorded job when one matches the brief's request, else the hash pick", async () => {
    const cast = { ...testJob("the-tallyman"), prompt: TALLY.one_line_request.toUpperCase() };
    const jobs = async () => [testJob("ghost-a"), cast, testJob("ghost-b")];
    const client = createReplayForgeClient({ jobs });
    const started = await client.start({ mode: "brief", brief: { ...TALLY, name: "Renamed" } });
    expect(parseReplayJobId(started.jobId)?.slug).toBe("the-tallyman");
    const other = await client.start({ mode: "brief", brief: CARDIA });
    expect(parseReplayJobId(other.jobId)?.slug).toMatch(/^ghost-|the-tallyman/);
    expect(fetches).toBe(0);
  });
});
