// forgeMachine.ts: the forge job's one runtime lifecycle - status lists, the step each status runs,
// legal transitions, and what a record at each status must carry (jobShapeError, which
// parseForgeJob ends with so a status-inconsistent record is refused at the store boundary).
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import m8 from "../test/fixtures/m8-parts.json";
import type { Rig } from "@sr/rig";
import { CAST_STATUSES, FORGE_ERROR_CODES, FORGE_STATUSES, RUNNING_STATUSES, canAdvance, jobShapeError, stepFor } from "./forgeMachine.js";
import type { ForgeJob } from "./job.js";
import { parseForgeJob } from "./validate.js";
import type { ForgeStatus } from "./wire.js";

const ROOT = new URL("../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const PARTS = m8 as ForgeJob["parts"];
const RIG: Rig = {
  version: 1,
  id: "t",
  name: "T",
  width: 8,
  height: 8,
  source: "forge",
  palette: { glow: "#ffffff", eye: "#28dcc8", rim: "#ffffff", mouth: "#000000" },
  layers: [{ name: "head", kind: "head", bbox: [0, 0, 8, 8], z: 1, file: "head.png", anchor: [4, 4] }],
};
const ASSETS = { "head.png": "https://x/head.png" };
const base = (status: ForgeStatus): ForgeJob => ({ jobId: "a".repeat(32), plane: "live", mode: "prompt", status, createdAt: 1 });

describe("one runtime definition of the lists", () => {
  it("equals the literal lists the parser, the cast and the client used to hand-copy", () => {
    expect(FORGE_STATUSES).toEqual(["queued", "portrait", "segmenting", "cutting", "filling", "expressing", "done", "failed"]);
    expect(RUNNING_STATUSES).toEqual(["queued", "portrait", "segmenting", "cutting", "filling", "expressing"]);
    expect(FORGE_ERROR_CODES).toEqual(["quota", "refused_likeness", "refused_content", "upstream", "bad_input"]);
    expect(CAST_STATUSES).toEqual(["drafting", "segmenting", "cutting", "ready", "failed"]);
  });

  it("no reader re-types them: validate, castJob, forge-steps, forge-replay and forgeClient import the machine", () => {
    const files = ["packages/forge/src/validate.ts", "packages/forge/src/castJob.ts", "api/_lib/forge-steps.ts", "api/_lib/forge-replay.ts", "apps/web/src/creator/forgeClient.ts"];
    for (const file of files) {
      const text = source(file);
      expect(text, file).not.toMatch(/"refused_likeness",\s*"refused_content"/);
      expect(text, file).not.toMatch(/"segmenting",\s*"cutting",\s*"filling"/);
      expect(text, file).not.toMatch(/"drafting",\s*"segmenting"/);
    }
    expect(source("apps/web/src/creator/forgeClient.ts")).toMatch(/from "@sr\/forge\/machine"/);
    expect(source("api/_lib/forge-steps.ts")).not.toMatch(/case "cutting"/);
  });
});

describe("canAdvance", () => {
  it("moves forward, fails from anywhere running, re-asks segmenting, and never leaves done or failed", () => {
    expect(canAdvance("segmenting", "cutting")).toBe(true);
    expect(canAdvance("filling", "segmenting")).toBe(false);
    expect(canAdvance("segmenting", "segmenting")).toBe(true);
    expect(canAdvance("expressing", "done")).toBe(true);
    for (const s of RUNNING_STATUSES) expect(canAdvance(s, "failed"), s).toBe(true);
    for (const to of FORGE_STATUSES) {
      expect(canAdvance("done", to), to).toBe(false);
      expect(canAdvance("failed", to), to).toBe(false);
    }
  });

  it("property: legal iff the target is later in the running order, or failed, or the segmenting re-ask", () => {
    const order: readonly ForgeStatus[] = [...RUNNING_STATUSES, "done"];
    const running = (s: ForgeStatus) => (RUNNING_STATUSES as readonly ForgeStatus[]).includes(s);
    fc.assert(
      fc.property(fc.constantFrom(...FORGE_STATUSES), fc.constantFrom(...FORGE_STATUSES), (from, to) => {
        const legal = running(from) && (to === "failed" || order.indexOf(to) > order.indexOf(from) || (from === "segmenting" && to === "segmenting"));
        expect(canAdvance(from, to)).toBe(legal);
      }),
    );
  });
});

describe("stepFor", () => {
  it("is the status -> step table the step runner dispatches by", () => {
    expect(stepFor("portrait")).toBe("portrait");
    expect(stepFor("segmenting")).toBe("parts");
    expect(stepFor("cutting")).toBe("fill");
    expect(stepFor("filling")).toBe("cut");
    expect(stepFor("done")).toBeUndefined();
    expect(stepFor("failed")).toBeUndefined();
    expect(stepFor("queued")).toBeUndefined();
  });
});

describe("jobShapeError", () => {
  it("an expressing record needs its rig, assets and expression index; the store refuses one without", () => {
    const job: ForgeJob = { ...base("expressing"), assets: ASSETS, expressionIndex: 0 };
    expect(jobShapeError(job)).toBe("expressing needs rig, assets, expressionIndex");
    expect(parseForgeJob(JSON.stringify(job))).toBeUndefined();
  });

  it("a cutting brief record needs its parts", () => {
    const job: ForgeJob = { ...base("cutting"), mode: "brief", portraitUrl: "https://x/p.png", portraitMime: "image/png" };
    expect(jobShapeError(job)).toMatch(/parts/);
    expect(parseForgeJob(JSON.stringify(job))).toBeUndefined();
  });

  it("a failed record needs its error; a done record with rig and assets is whole", () => {
    expect(jobShapeError(base("failed"))).toBeDefined();
    expect(parseForgeJob(JSON.stringify(base("failed")))).toBeUndefined();
    expect(jobShapeError({ ...base("done"), rig: RIG, assets: ASSETS })).toBeUndefined();
  });
});

/** A record at `status` carrying exactly what its invariant asks, plus arbitrary optional extras. */
const jobAt = (status: ForgeStatus): fc.Arbitrary<ForgeJob> => {
  const portrait = { portraitUrl: fc.webUrl(), portraitMime: fc.constantFrom("image/png" as const, "image/jpeg" as const) };
  const needs: Record<ForgeStatus, Record<string, fc.Arbitrary<unknown>>> = {
    queued: {},
    portrait: { mode: fc.constant("image"), uploadUrl: fc.webUrl(), uploadMime: fc.constantFrom("image/png" as const, "image/webp" as const) },
    segmenting: portrait,
    cutting: { ...portrait, parts: fc.constant(PARTS) },
    filling: { ...portrait, parts: fc.constant(PARTS), fill: fc.constantFrom("edit" as const, "fallback" as const) },
    expressing: { rig: fc.constant(RIG), assets: fc.constant(ASSETS), expressionIndex: fc.nat({ max: 5 }), eyes: fc.constantFrom("edit" as const, "fallback" as const, "none" as const) },
    done: { rig: fc.constant(RIG), assets: fc.constant(ASSETS), fill: fc.constantFrom("edit" as const, "fallback" as const) },
    failed: { error: fc.record({ code: fc.constantFrom(...FORGE_ERROR_CODES), message: fc.string() }) },
  };
  const required = { jobId: fc.stringMatching(/^[a-f0-9]{32}$/), plane: fc.constantFrom("replay" as const, "live" as const), mode: fc.constantFrom("prompt" as const, "image" as const), status: fc.constant(status), createdAt: fc.nat() };
  const extras = { stepStartedAt: fc.nat(), prompt: fc.string(), partsAsks: fc.nat({ max: 2 }), timings: fc.record({ portrait: fc.nat(), parts: fc.nat() }, { requiredKeys: [] }) };
  return fc
    .tuple(fc.record(required), fc.record(extras, { requiredKeys: [] }), fc.record(needs[status]))
    .map(([r, e, n]) => ({ ...r, ...e, ...n }) as ForgeJob);
};

describe("records generated per status", () => {
  it("property: satisfy their invariant and round-trip parseForgeJob deep-equal", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FORGE_STATUSES).chain(jobAt), (job) => {
        expect(jobShapeError(job)).toBeUndefined();
        expect(parseForgeJob(JSON.stringify(job))).toEqual(job);
      }),
    );
  });
});
