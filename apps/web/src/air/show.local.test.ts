// C4: the show controller with a local script (a forged character's sheet on the replay plane):
// replies come from the script in the browser and a line is voiced only by an exact recording, so
// no request reaches /api/engine/reply or /api/voice (the paid endpoints) at all.
import type { ShowBank } from "@sr/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localScript, sheetShow } from "./sheetShow";
import { BEAT_MS } from "./show";
import { flush, play, setup } from "./showKit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const SHEET = { archetype: "Drowned diver", hook: "Hums shanties.", lines: ["Kneel.", "Bubbles mean I laugh."] };

describe("a local script", () => {
  it("answers every beat from the sheet, captions only, with zero fetches", async () => {
    const script = sheetShow("forge-brine", SHEET);
    const { show, seen } = setup({ show: script, local: localScript(script, "choir", { shows: [], recorded: new Set() }) });
    show.start();
    await flush();
    expect(show.snapshot()).toMatchObject({ status: "speaking", caption: { line: "Kneel.", voiced: false } });
    await play(BEAT_MS + 500);
    expect(show.snapshot().caption?.line).toBe("Bubbles mean I laugh.");
    await play(BEAT_MS);
    expect(show.snapshot().caption?.line).toBe("Kneel.");
    expect(seen.fetched).toEqual([]);
    expect(seen.played).toEqual([]);
    show.stop();
  });

  it("plays a line's exact recording from its static URL, still without a fetch", async () => {
    const script = sheetShow("forge-brine", SHEET);
    const recorded = sheetShow("malakor", { ...SHEET, lines: ["Kneel."] });
    const malakorNight = { ...recorded, beats: recorded.beats.map((b) => ({ ...b, wav: "malakor-night/b00.wav" })) };
    const bank: ShowBank = { shows: [malakorNight], recorded: new Set(["malakor-night/b00.wav"]) };
    const { show, seen } = setup({ show: script, local: localScript(script, "clerk", bank) });
    show.start();
    await flush();
    expect(show.snapshot().caption).toMatchObject({ line: "Kneel.", voiced: true });
    expect(seen.played).toEqual(["/replay/shows/malakor-night/b00.wav"]);
    expect(seen.fetched).toEqual([]);
    show.stop();
  });
});
