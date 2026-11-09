/// <reference types="node" />
// Every recorded cast rig takes the right lip-sync path (perfection-pass task 4, requirement 4.3):
// a track's shapes reach the mouth of a "drawn" or "warp" rig and open its jaw; a "still" rig or
// one with no measured mouth keeps the level drive (no mouth pose, the jaw from the level). The rigs
// are read from the replay forge jobs as committed; no art or measurement is changed.
import { readdirSync, readFileSync } from "node:fs";
import { defaultLook, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { mouthMode } from "../mouth/anchor.js";
import { mixSpans } from "../mouth/track.js";
import { createFrameBody } from "../player/frame.js";

const FORGE = new URL("../../../../assets/replay/forge/", import.meta.url);
const cast = readdirSync(FORGE).map((slug) => {
  const job = JSON.parse(readFileSync(new URL(`${slug}/job.json`, FORGE), "utf8")) as { rig: Rig };
  return [slug, job.rig] as const;
});

/** What each cast member's mouth does today (scripts/cast/mouth-backfill.mjs measured them). */
const EXPECTED: Readonly<Record<string, ReturnType<typeof mouthMode>>> = {
  "announcer-of-dead-air": "warp",
  "auntie-asp": "warp",
  "lantern-warden": "warp",
  "lot-ninety": "warp",
  malakor: undefined,
  "moth-widow": "warp",
  reveille: undefined,
  "saint-cardia": "warp",
  "sir-vacant": undefined,
  "sister-vesper": "warp",
  "the-redactor": "warp",
  "the-tallyman": "drawn",
  understudy: "still",
  "vicar-of-the-lure": undefined,
};

const wide = mixSpans([{ shape: "openWide", startMs: 0, endMs: 1000 }], 500);

describe("the cast's lip-sync paths", () => {
  it("knows every cast rig's mouth mode", () => {
    expect(Object.fromEntries(cast.map(([slug, rig]) => [slug, mouthMode(rig.mouth)]))).toEqual(EXPECTED);
  });

  it.each(cast)("%s: shapes for a drawn or warp mouth, the level jaw otherwise", (_slug, rig) => {
    const mode = mouthMode(rig.mouth);
    const body = createFrameBody(1);
    const look = { ...defaultLook(rig), emotion: "neutral" as const };
    const out = body({ rig, look, dt: 0.1, level: 0, gaze: "host", reducedMotion: false, mouth: { shapes: wide } });
    if (mode === "drawn" || mode === "warp") {
      expect(out.clock.mouth?.params.open ?? 0).toBeGreaterThan(0.9);
      expect(out.clock.mouth?.alpha).toBe(1);
    } else {
      expect(out.clock.mouth).toBeUndefined();
    }
  });
});
