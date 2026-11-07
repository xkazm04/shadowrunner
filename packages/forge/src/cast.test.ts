// cast.ts and castJob.ts (forge-creator L2): casting rules shared by both planes, the batch records,
// and the casting wire bodies in validate.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { portraitPromptFromBrief } from "./brief.js";
import {
  CAST_SIZE,
  CAST_VARIATIONS,
  MAX_REROLLS,
  castOrder,
  castTrio,
  draftPrompt,
  missingParts,
  parseReplayBatchId,
  RECORDED_OTHER_NOTE,
  RECORDED_PRIMARY_NOTE,
  replayBatchId,
  replayCastStatus,
  replayCastView,
  rerollsLeft,
  type RecordedCandidate,
} from "./cast.js";
import type { Rig } from "@sr/rig";
import { castCutId, toCastView, type CastBatch } from "./castJob.js";
import { parseCastRecord, parseCastRequest, parseForgeRequest } from "./validate.js";
import type { CharacterBrief } from "./wire.js";

const BRIEF: CharacterBrief = {
  name: "Brine",
  one_line_request: "an iron diving helmet that hums sea shanties",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties between lines and counts the fathoms of chat.",
  accent_hex: "#38c8ff",
  silhouette: "A round helmet with a glowing porthole and a hose curling up.",
  parts: [
    { name: "helmet", role: "head", what: "round iron helmet" },
    { name: "jaw", role: "jaw", what: "hinged faceplate lip", motion: "drops with speech" },
    { name: "eye_l", role: "eye_l", what: "left porthole eye" },
    { name: "eye_r", role: "eye_r", what: "right porthole eye" },
    { name: "hose", role: "float", what: "curling air hose", motion: "drifts", follow: "helmet" },
    { name: "suit", role: "torso", what: "canvas diving suit" },
  ],
  style: { name: "Low-poly 3D", why: "Planes cut cleanly." },
  portrait_prompt: "Low-poly planes. An iron diving helmet with two porthole eyes and a curling hose.",
};

const name = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const slug = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);

describe("cast.ts", () => {
  it("draftPrompt: the brief's portrait prompt with one distinct framing sentence per candidate", () => {
    const prompts = Array.from({ length: CAST_SIZE }, (_, i) => draftPrompt(BRIEF, i));
    expect(new Set(prompts).size).toBe(CAST_SIZE);
    prompts.forEach((p, i) => {
      expect(p.startsWith(portraitPromptFromBrief(BRIEF))).toBe(true);
      expect(p.endsWith(CAST_VARIATIONS[i] ?? "")).toBe(true);
    });
  });

  it("missingParts: exactly the planned names not found, in plan order, each once (property)", () => {
    fc.assert(
      fc.property(fc.array(name, { maxLength: 12 }), fc.array(name, { maxLength: 12 }), (planned, found) => {
        const missing = missingParts(planned, found);
        const have = new Set(found);
        expect(missing.every((m) => planned.includes(m) && !have.has(m))).toBe(true);
        expect(new Set(missing).size).toBe(missing.length);
        expect(missing).toEqual([...new Set(planned)].filter((p) => !have.has(p)));
        for (const p of planned) expect(have.has(p) || missing.includes(p)).toBe(true);
      }),
    );
  });

  it("castOrder: a permutation of the slugs, primary first, the same for the same key (property)", () => {
    fc.assert(
      fc.property(fc.uniqueArray(slug, { minLength: 1, maxLength: 14 }), fc.string(), fc.nat(), (slugs, key, pick) => {
        const primary = slugs[pick % slugs.length];
        const order = castOrder(key, slugs, primary);
        expect([...order].sort()).toEqual([...slugs].sort());
        expect(order[0]).toBe(primary);
        expect(castOrder(key, [...slugs].reverse(), primary)).toEqual(order);
        expect([...castOrder(key, slugs)].sort()).toEqual([...slugs].sort());
      }),
    );
  });

  it("castTrio: CAST_SIZE distinct slugs; round 0 starts with the primary; rounds before wrapping never repeat (property)", () => {
    fc.assert(
      fc.property(fc.uniqueArray(slug, { minLength: 9, maxLength: 14 }), fc.string(), (slugs, key) => {
        const primary = slugs[0];
        const rounds = Array.from({ length: MAX_REROLLS + 1 }, (_, r) => castTrio(key, slugs, primary, r));
        for (const trio of rounds) {
          expect(trio).toHaveLength(CAST_SIZE);
          expect(new Set(trio).size).toBe(CAST_SIZE);
          expect(trio.every((s) => slugs.includes(s))).toBe(true);
        }
        expect(rounds[0]?.[0]).toBe(primary);
        expect(new Set(rounds.flat()).size).toBe(CAST_SIZE * (MAX_REROLLS + 1));
      }),
    );
  });

  it("castTrio: fewer recordings than CAST_SIZE gives each once", () => {
    expect(castTrio("k", ["a", "b"], "a", 0)).toEqual(["a", "b"]);
  });

  it("replay batch ids round-trip (property) and refuse anything else", () => {
    fc.assert(
      fc.property(fc.uniqueArray(slug, { minLength: 1, maxLength: CAST_SIZE }), fc.integer({ min: 0, max: MAX_REROLLS }), fc.nat(2 ** 42), fc.boolean(), (slugs, round, startedAt, primary) => {
        expect(parseReplayBatchId(replayBatchId({ round, startedAt, slugs, primary }))).toEqual({ round, startedAt, slugs, primary });
      }),
    );
    for (const bad of ["", "replaycast_0_1_", "replaycast_x_1_a", "replaycast_0_1_A", "replaycast_0_1_a~b~c~d", "replay_sir-vacant_1"]) {
      expect(parseReplayBatchId(bad)).toBeUndefined();
    }
  });

  it("replayCastStatus only moves forward as time passes (property)", () => {
    const order = ["drafting", "segmenting", "cutting", "ready"];
    fc.assert(
      fc.property(fc.nat(10_000), fc.nat(10_000), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(order.indexOf(replayCastStatus(lo))).toBeLessThanOrEqual(order.indexOf(replayCastStatus(hi)));
      }),
    );
  });

  it("replayCastView: portraits from cutting on, rigs without faces when ready, a note on each; an unknown slug is no view", () => {
    const rig: Rig = {
      version: 1, id: "r", name: "R", width: 8, height: 8, source: "forge", fictional: true,
      palette: { glow: "#ffffff", eye: "#28dcc8", rim: "#ffffff", mouth: "#000000" },
      layers: [{ name: "head", kind: "head", file: "head.png", bbox: [0, 0, 8, 8], anchor: [4, 4], z: 1, variants: { joy: { file: "head.joy.png", bbox: [0, 0, 4, 4], mode: "over" } } }],
    };
    const job = (slug: string): RecordedCandidate => ({ slug, portraitUrl: `/${slug}.png`, rig, assets: { "head.png": "/h.png", "head.joy.png": "/j.png" } });
    const jobs = new Map(["a", "b", "c"].map((s) => [s, job(s)]));
    const batch = { round: 0, startedAt: 0, slugs: ["a", "b", "c"], primary: true };
    expect(replayCastView("id", batch, jobs, 0)?.candidates.every((c) => c.portraitUrl === undefined && c.state === "drafting")).toBe(true);
    expect(replayCastView("id", batch, jobs, 2000)?.candidates.every((c) => c.portraitUrl !== undefined && c.rig === undefined)).toBe(true);
    const ready = replayCastView("id", batch, jobs, 5000);
    expect(ready?.status).toBe("ready");
    expect(ready?.candidates.map((c) => c.note)).toEqual([RECORDED_PRIMARY_NOTE, RECORDED_OTHER_NOTE, RECORDED_OTHER_NOTE]);
    expect(ready?.candidates[0]?.rig?.layers[0]?.variants).toBeUndefined();
    expect(ready?.candidates[0]?.assets).toEqual({ "head.png": "/h.png" });
    expect(replayCastView("id", { ...batch, slugs: ["a", "zz"] }, jobs, 5000)).toBeUndefined();
  });

  it("rerollsLeft counts down to 0", () => {
    expect([0, 1, 2, 3].map(rerollsLeft)).toEqual([2, 1, 0, 0]);
  });
});

const BATCH: CastBatch = {
  jobId: "a".repeat(32),
  kind: "batch",
  plane: "live",
  status: "ready",
  createdAt: 1,
  brief: BRIEF,
  round: 1,
  slots: [
    { state: "cut", portraitUrl: "data:image/png;base64,AA==", portraitMime: "image/png", missing: ["hose"], empty: ["eye_r"], warnings: ["no head layer"] },
    { state: "uncut", portraitUrl: "data:image/png;base64,AA==", portraitMime: "image/png", missing: [], empty: [], warnings: [], note: "parts not read" },
    { state: "failed", missing: [], empty: [], warnings: [], note: "no portrait" },
  ],
};

describe("castJob.ts", () => {
  it("toCastView: lists always present, no rig without a cut record, re-rolls left from the round", () => {
    const view = toCastView(BATCH, []);
    expect(view).toMatchObject({ batchId: BATCH.jobId, status: "ready", plane: "live", rerollsLeft: 1 });
    expect(view.candidates.map((c) => c.state)).toEqual(["cut", "uncut", "failed"]);
    expect(view.candidates[0]).toEqual({ index: 0, state: "cut", portraitUrl: "data:image/png;base64,AA==", missing: ["hose"], empty: ["eye_r"], warnings: ["no head layer"] });
    expect(view.candidates[2]).not.toHaveProperty("portraitUrl");
    expect(toCastView({ ...BATCH, next: "b".repeat(32) }, []).rerollsLeft).toBe(0);
    expect(toCastView({ ...BATCH, forgeJobId: "j".repeat(32) }, []).jobId).toBe("j".repeat(32));
    expect(JSON.stringify(view)).not.toContain("null");
  });

  it("a batch record round-trips through parseCastRecord; a broken one is refused", () => {
    expect(parseCastRecord(JSON.stringify(BATCH))).toEqual(BATCH);
    expect(parseCastRecord(JSON.stringify({ ...BATCH, status: "cooking" }))).toBeUndefined();
    expect(parseCastRecord(JSON.stringify({ ...BATCH, slots: [{ state: "cut" }] }))).toBeUndefined();
    expect(parseCastRecord(JSON.stringify({ ...BATCH, kind: "job" }))).toBeUndefined();
    expect(parseCastRecord("not json")).toBeUndefined();
    expect(castCutId(BATCH.jobId, 2)).toBe(`${BATCH.jobId}-c2`);
  });
});

describe("validate.ts: casting bodies", () => {
  it("parseCastRequest: a valid brief, an optional batch id to re-roll", () => {
    expect(parseCastRequest(JSON.stringify({ brief: BRIEF }))).toEqual({ ok: true, value: { brief: BRIEF } });
    expect(parseCastRequest(JSON.stringify({ brief: BRIEF, after: "a".repeat(32) }))).toEqual({ ok: true, value: { brief: BRIEF, after: "a".repeat(32) } });
    expect(parseCastRequest(JSON.stringify({ brief: BRIEF, after: "../x" })).ok).toBe(false);
    expect(parseCastRequest(JSON.stringify({ brief: { name: "x" } })).ok).toBe(false);
    expect(parseCastRequest("[]").ok).toBe(false);
  });

  it("parseForgeRequest: mode brief may carry { batchId, index } with index 0..2", () => {
    const pick = { batchId: "a".repeat(32), index: 1 };
    expect(parseForgeRequest(JSON.stringify({ mode: "brief", brief: BRIEF, candidate: pick }))).toEqual({ ok: true, value: { mode: "brief", brief: BRIEF, candidate: pick } });
    for (const bad of [{ batchId: "a".repeat(32), index: 3 }, { batchId: "a".repeat(32), index: 0.5 }, { batchId: "a/b", index: 0 }, { index: 0 }, "x"]) {
      expect(parseForgeRequest(JSON.stringify({ mode: "brief", brief: BRIEF, candidate: bad })).ok).toBe(false);
    }
  });
});
