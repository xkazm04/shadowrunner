import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DirectorMessage, RunConfig, TimelineEvent } from "../../contract.js";
import { runReplay } from "../replay.js";
import { readTimeline } from "../timeline.js";
import { encodeWav } from "../voice/wav.js";
import { fakeDeps, virtualClock, type Calls } from "./fakes.js";

const SOURCE = "src-run";
const config: RunConfig = { control: "C0", lip: "L0", scene: "S0", output: "O0", scenario: "haunt-01", seed: 7 };
const events: TimelineEvent[] = [
  { t: 0, kind: "mark", name: "wire:cli test" },
  { t: 600, kind: "turn", turn: 1, chat: { id: "c1", user: "u", text: "hi", atMs: 2000 } },
  { t: 610, kind: "mark", name: "play:1" },
  // Turn 2 arrives while turn 1 is still thinking: turn 1's audio must still count for turn 1.
  { t: 1000, kind: "turn", turn: 2, chat: { id: "c2", user: "v", text: "yo", atMs: 3000 } },
  { t: 2000, kind: "emotion", value: "amused" },
  { t: 2000, kind: "say", id: "say-c1", text: "Counted." },
  { t: 2500, kind: "audio", id: "say-c1", sampleRate: 24000, pcmRef: "audio/say-c1.wav", durationMs: 100 },
  { t: 2500, kind: "viseme", id: "say-c1", v: "kk", startMs: 0, endMs: 50 },
];

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lab-replay-"));
  process.env.SR_LAB_RUNS_DIR = root;
  const dir = join(root, SOURCE);
  mkdirSync(join(dir, "audio"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  writeFileSync(join(dir, "timeline.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
  writeFileSync(join(dir, "audio", "say-c1.wav"), encodeWav(Buffer.alloc(4800), 24000));
});
afterEach(() => {
  delete process.env.SR_LAB_RUNS_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("replay", () => {
  it("re-renders a recorded run with zero LLM and zero TTS calls", async () => {
    const calls: Calls = { control: 0, voice: 0 };
    const sent: DirectorMessage[] = [];
    const clock = virtualClock();
    const result = await runReplay({ sourceRunId: SOURCE, headless: true, debug: false }, fakeDeps(clock, sent, calls));

    expect(calls).toEqual({ control: 0, voice: 0 });
    const replayed = readTimeline(join(result.dir, "timeline.jsonl"));
    expect(replayed.map((e) => e.kind)).toEqual(events.map((e) => e.kind));
    expect(replayed.map((e) => e.t)).toEqual(events.map((e) => e.t));
    expect(existsSync(join(result.dir, "audio", "say-c1.wav"))).toBe(true);
    expect(JSON.parse(readFileSync(join(result.dir, "config.json"), "utf8"))).toMatchObject({ ...config, replayOf: SOURCE });
    // PCM goes out before its audio event, then the run ends.
    const kinds = sent.map((m) => (m.type === "event" ? m.event.kind : m.type));
    expect(kinds.indexOf("pcm")).toBe(kinds.indexOf("audio") - 1);
    expect(kinds.at(-1)).toBe("end");
    expect(result.metrics).toMatchObject({ ttfaMs: 1900, turnLatencyMs: [1900], renderBackend: "swiftshader", droppedFrames: 1 });
    expect(result.metrics.tokensIn).toBeUndefined();
    expect(result.metrics.controlErrors).toBeUndefined();
  });

  it("refuses a pcmRef outside the run's audio folder", async () => {
    const bad = events.map((e) => (e.kind === "audio" ? { ...e, pcmRef: "../../secret.wav" } : e));
    writeFileSync(join(root, SOURCE, "timeline.jsonl"), bad.map((e) => JSON.stringify(e)).join("\n"));
    const calls: Calls = { control: 0, voice: 0 };
    await expect(runReplay({ sourceRunId: SOURCE, headless: true, debug: false }, fakeDeps(virtualClock(), [], calls))).rejects.toThrow(/not audio\/<name>\.wav/);
  });
});
