// cast-forge task 10 (requirement 4.3): the brief client. The http client posts {request} to
// /api/forge/brief and checks the answer with parseBrief; every failure is a ForgeError with a wire
// code. The replay twin reads the committed cast briefs in the browser and never fetches.
// A brief started on the replay forge plays the cast member's recorded job when there is one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_URL, createHttpBriefClient, createReplayBriefClient, loadRecordedBriefs, readBriefResponse } from "./briefClient";
import { parseReplayBatchId } from "@sr/forge/cast";
import { createReplayCastClient } from "./castClient";
import { ForgeError } from "./forgeClient";
import { createReplayForgeClient, parseReplayJobId } from "./forgeClient.replay";
import { loadReplayJobs } from "./replayJobs";
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
  it("reads the thirteen cast briefs and answers a one-line request with its own, without a request", async () => {
    const briefs = await loadRecordedBriefs();
    // The eight recorded, and (perfection-pass task 13) the five written after the recording; never Malakor.
    expect(briefs).toHaveLength(13);
    expect(briefs.filter((b) => b.authored === "after-recording").map((b) => b.name)).toEqual(["Announcer of Dead Air", "The Lantern Warden", "The Moth Widow", "Sister Vesper", "The Understudy"]);
    expect(briefs.some((b) => /malakor/i.test(b.name))).toBe(false);
    const client = createReplayBriefClient();
    expect((await client.brief("A SPOOKY census guy  that counts everyone in chat")).brief.name).toBe("The Tallyman");
    const near = await client.brief("a fish priest from the deep");
    expect(near).toEqual({ brief: briefs.find((b) => b.name === "Vicar of the Lure"), plane: "replay", match: { name: "Vicar of the Lure", how: "words", matched: ["fish", "deep"] } });
    expect((await client.brief("a vampire accountant")).match).toEqual({ name: "Saint Cardia of the Glass Heart", how: "none", matched: [] });
    expect((await client.brief("a moth woman with a veil")).match).toEqual({ name: "The Moth Widow", how: "words", matched: ["moth", "woman"], authored: "after-recording" });
    await expect(client.brief("  ")).rejects.toMatchObject({ code: "bad_input" });
    expect(fetches).toBe(0);
  });

  it("the http client keeps a replay answer's match note and drops a malformed one", async () => {
    const note = { name: "The Tallyman", how: "words", matched: ["census"] };
    expect(await createHttpBriefClient(reply(200, { brief: TALLY, plane: "replay", match: note })).brief("census")).toEqual({ brief: TALLY, plane: "replay", match: note });
    expect(readBriefResponse({ brief: TALLY, plane: "replay", match: { name: "x", how: "guess", matched: [] } })).toEqual({ brief: TALLY, plane: "replay" });
    expect(readBriefResponse({ brief: TALLY, plane: "live", match: note })).toEqual({ brief: TALLY, plane: "live" });
  });
});

// perfection-pass task 8 (requirement 8.2): over the committed recordings, the brief a request gets
// and the character the replay forge (direct, and the casting's first draft) then walks agree.
describe("replay: the brief shown is the character forged", () => {
  it.each([
    "a ghost butler with white gloves",
    "a skeleton knight in rusty armour",
    "a snake lady who hates noise",
    "a fish priest from the deep",
    "a clock that rings when I go live",
    "a saint made of porcelain",
    "an angry censor with a black bar",
    "a many-eyed accountant counting viewers",
    "a vampire accountant",
    "a moth woman with a veil",
    // perfection-pass task 13: the five written after the recording, by their signature traits.
    "a drowned nun with floating hair",
    "a creepy puppet with a wooden jaw",
    "a pumpkin head with a lantern and a hat",
    "a hooded radio announcer",
  ])("%s", async (request) => {
    const { brief } = await createReplayBriefClient().brief(request);
    const jobs = await loadReplayJobs();
    const started = await createReplayForgeClient({ jobs: async () => jobs }).start({ mode: "brief", brief });
    const job = jobs.find((j) => j.slug === parseReplayJobId(started.jobId)?.slug);
    expect(job?.name).toBe(brief.name);
    expect(job?.prompt).toBe(brief.one_line_request);
    const batch = parseReplayBatchId((await createReplayCastClient({ jobs: async () => jobs }).draft(brief)).batchId);
    expect(batch?.primary).toBe(true);
    expect(batch?.slugs[0]).toBe(job?.slug);
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
