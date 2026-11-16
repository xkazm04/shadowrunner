import { describe, expect, it } from "vitest";
import { parseRunConfig } from "../../director/config.js";
import { labRunFor, measureHint, readThRun } from "../import.js";

const run = { schema: "th-run/1", arm: "diffusion-it", script: "pitch-45s", seed: 1116, durationS: 44.2, faceRoi: [380, 520, 320, 240] };

describe("talking-head import", () => {
  it("reads a th-run/1 file and rejects anything else", () => {
    expect(readThRun(JSON.stringify(run))).toEqual({ arm: "diffusion-it", script: "pitch-45s", seed: 1116, durationS: 44.2, faceRoi: [380, 520, 320, 240] });
    expect(readThRun(JSON.stringify({ ...run, faceRoi: null })).faceRoi).toBeNull();
    expect(() => readThRun(JSON.stringify({ ...run, schema: "th-run/2" }))).toThrow(/schema/);
    expect(() => readThRun(JSON.stringify({ ...run, arm: "../x" }))).toThrow(/arm/);
    expect(() => readThRun(JSON.stringify({ ...run, faceRoi: [1, 2, 3] }))).toThrow(/faceRoi/);
  });

  it("writes an external talking-head config the lab accepts, with one line at t=0", () => {
    const out = labRunFor(readThRun(JSON.stringify(run)), " Hello there.\n", "20261116-120000");
    expect(out.runId).toBe("20261116-120000-pitch-45s-th-diffusion-it-s1116");
    expect(parseRunConfig(out.config).external).toBe("talking-head");
    expect(JSON.parse(out.timeline)).toEqual({ t: 0, kind: "say", id: "say-1", text: "Hello there." });
  });

  it("prints the measure command with the face ROI", () => {
    expect(measureHint("d", [1, 2, 3, 4])).toMatch(/--roi 1,2,3,4$/);
    expect(measureHint("d", null)).toMatch(/needs --roi/);
  });
});
