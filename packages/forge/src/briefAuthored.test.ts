// perfection-pass task 13 (requirement 13.1, 13.2): the five briefs written after the recording
// (Moth Widow, Sister Vesper, Understudy, Lantern Warden, Announcer of Dead Air) are read from
// that recording, not invented beside it: the name and one_line_request are the forge job's own
// (so the replay forge finds the job by one_line_request, as for the eight), style.prompt is the
// portraitPrompt that drew the portrait, and the parts are the rig's layers. They carry the
// after-recording mark, which only the recorded-brief adapter keeps, and fire no signature act
// (the stage reads acts from every cast brief; these five were never given one).
import j_announcer from "../../../assets/replay/forge/announcer-of-dead-air/job.json";
import j_lantern from "../../../assets/replay/forge/lantern-warden/job.json";
import j_moth from "../../../assets/replay/forge/moth-widow/job.json";
import j_vesper from "../../../assets/replay/forge/sister-vesper/job.json";
import j_understudy from "../../../assets/replay/forge/understudy/job.json";
import b_announcer from "../../../assets/characters/cast/announcer-of-dead-air/brief.json";
import b_lantern from "../../../assets/characters/cast/lantern-warden/brief.json";
import b_moth from "../../../assets/characters/cast/moth-widow/brief.json";
import b_vesper from "../../../assets/characters/cast/sister-vesper/brief.json";
import b_understudy from "../../../assets/characters/cast/understudy/brief.json";
import b_sir_vacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import { describe, expect, it } from "vitest";
import { briefFromRecorded, parseBrief } from "./brief.js";
import { actsFromRecordedParts } from "./briefActs.js";
import { portraitPrompt } from "./prompts.js";

const FIVE: [string, unknown, { name: string; prompt: string; rig: { layers: { name: string; kind: string }[] } }][] = [
  ["announcer-of-dead-air", b_announcer, j_announcer],
  ["lantern-warden", b_lantern, j_lantern],
  ["moth-widow", b_moth, j_moth],
  ["sister-vesper", b_vesper, j_vesper],
  ["understudy", b_understudy, j_understudy],
];

/** The rig's drawn parts: every layer but the plate and the irises the forge cuts from the eyes. */
const drawnParts = (layers: readonly { name: string; kind: string }[]): string[] =>
  layers.filter((l) => l.kind !== "static" && l.kind !== "iris").map((l) => l.name).sort();

describe("the five briefs written after the recording", () => {
  it.each(FIVE)("%s is read from its recording and marked as written after it", (_slug, raw, job) => {
    const brief = briefFromRecorded(raw);
    if (!brief.ok) throw new Error(JSON.stringify(brief.errors));
    expect(brief.value.authored).toBe("after-recording");
    expect(brief.value.name).toBe(job.name);
    expect(brief.value.one_line_request).toBe(job.prompt);
    expect(typeof raw === "object" && raw !== null && "style" in raw ? raw.style : undefined).toMatchObject({ prompt: portraitPrompt(job.prompt) });
    expect(brief.value.parts.map((p) => p.name).sort()).toEqual(drawnParts(job.rig.layers));
    expect(typeof raw === "object" && raw !== null && "parts" in raw ? actsFromRecordedParts(raw.parts).size : -1).toBe(0);
  });

  it("only the recorded-brief adapter keeps the mark; a misspelt one is refused, never read as recorded", () => {
    const sir = briefFromRecorded(b_sir_vacant);
    expect(sir.ok && sir.value.authored).toBe(undefined);
    const moth = briefFromRecorded(b_moth);
    if (!moth.ok) throw new Error("moth");
    // parseBrief (live answers, the wire) drops it: a model cannot claim it.
    const live = parseBrief(moth.value);
    expect(live.ok && "authored" in live.value).toBe(false);
    const typo = briefFromRecorded({ ...b_moth, authored: "after recording" });
    expect(typo.ok).toBe(false);
    expect(typo.ok ? [] : typo.errors.map((e) => e.path)).toEqual(["$.authored"]);
  });
});
