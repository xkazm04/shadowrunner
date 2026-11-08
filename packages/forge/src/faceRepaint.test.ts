// forge-creator S2: the repaint's pure half. The prompt's attempt from the reading and the hint;
// the ledger never lets a family past MAX_FAMILY_REPAINTS or a job past MAX_JOB_REPAINTS and keeps
// one key per spent repaint; the stored ledger and the wire candidate read back as written and
// anything off-contract is refused; the request body and the job view's repaint window.
import { EXPRESSION_FAMILIES, type ExpressionFamily, type LayerPatch } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FACE_GATE_REASONS, gateReading } from "./faceGate.js";
import {
  EMPTY_LEDGER,
  MAX_FAMILY_REPAINTS,
  MAX_JOB_REPAINTS,
  readLayerPatch,
  readRepaintCandidate,
  readRepaintLedger,
  repaintAttempt,
  repaintRefusal,
  repaintsLeft,
  repaintTag,
  reserveRepaint,
  settleRepaint,
  type RepaintLedger,
} from "./faceRepaint.js";
import { JOB_LIFETIME_MS, toJobView, type ForgeJob } from "./job.js";
import { parseForgeJob, parseRepaintRequest } from "./validate.js";
import type { RepaintCandidate } from "./wire.js";

const family = fc.constantFrom(...EXPRESSION_FAMILIES);
const key = fc.stringMatching(/^[A-Za-z0-9_-]{8,40}$/);
const patch: fc.Arbitrary<LayerPatch> = fc
  .record({
    layer: fc.stringMatching(/^[a-z0-9_]{1,12}$/),
    bbox: fc.tuple(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 900 }), fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 200 })),
    mode: fc.constantFrom("over" as const, "replace" as const),
    socket: fc.boolean(),
    narrowed: fc.boolean(),
  })
  .map(({ layer, bbox, mode, socket, narrowed }) => ({ file: `${layer}.joy_r1.png`, bbox, mode, ...(socket ? { socket: `${layer}.joy_r1.socket.png` } : {}), ...(narrowed ? { narrowed: true as const } : {}) }));

const candidate = (f: ExpressionFamily): fc.Arbitrary<RepaintCandidate> =>
  fc.record({ ok: fc.boolean(), plane: fc.constantFrom("live" as const, "replay" as const), layers: fc.dictionary(fc.stringMatching(/^[a-z0-9_]{1,12}$/), patch, { minKeys: 1, maxKeys: 6 }), reason: fc.constantFrom(...FACE_GATE_REASONS), leftF: fc.integer({ min: 0, max: MAX_FAMILY_REPAINTS }), leftJ: fc.integer({ min: 0, max: MAX_JOB_REPAINTS }) }).map(
    ({ ok, plane, layers, reason, leftF, leftJ }) => {
      if (!ok) return { family: f, ok, plane, gate: gateReading(reason), left: { family: leftF, job: leftJ } };
      const assets: Record<string, string> = {};
      for (const p of Object.values(layers)) for (const file of [p.file, ...(p.socket === undefined ? [] : [p.socket])]) assets[file] = `https://x.public.blob.vercel-storage.com/${file}`;
      return { family: f, ok, plane, patch: { layers, assets }, left: { family: leftF, job: leftJ } };
    },
  );

/** Repaint requests in order; each is reserved only when the ledger allows it. */
function run(asks: readonly { family: ExpressionFamily; key: string }[]): { ledger: RepaintLedger; refused: number } {
  let ledger = EMPTY_LEDGER;
  let refused = 0;
  for (const ask of asks) {
    if (ledger.keys[ask.key] !== undefined) continue;
    if (repaintRefusal(ledger, ask.family) !== undefined) {
      refused += 1;
      continue;
    }
    ledger = reserveRepaint(ledger, ask.key, ask.family, 5);
  }
  return { ledger, refused };
}

describe("repaintAttempt", () => {
  it("is 0..2: iris 1, band and drift 2, no_change 0, no reading 1; too subtle is always 0", () => {
    fc.assert(
      fc.property(fc.option(fc.constantFrom(...FACE_GATE_REASONS), { nil: undefined }), fc.boolean(), (reason, subtle) => {
        const reading = reason === undefined ? undefined : gateReading(reason);
        const a = repaintAttempt(reading, subtle ? "too_subtle" : undefined);
        expect([0, 1, 2]).toContain(a);
        if (subtle) expect(a).toBe(0);
        else expect(a).toBe(reason === "band" || reason === "drift" ? 2 : reason === "no_change" ? 0 : 1);
      }),
    );
  });
});

describe("the repaint ledger", () => {
  it("never passes the caps, keeps one key per repaint spent, and refuses exactly at a cap", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ family, key }), { maxLength: 20 }), (asks) => {
        const { ledger } = run(asks);
        const counts = Object.values(ledger.counts);
        const spent = counts.reduce((a, n) => a + n, 0);
        expect(counts.every((n) => n >= 1 && n <= MAX_FAMILY_REPAINTS)).toBe(true);
        expect(spent).toBeLessThanOrEqual(MAX_JOB_REPAINTS);
        expect(Object.keys(ledger.keys)).toHaveLength(spent);
        for (const f of EXPRESSION_FAMILIES) {
          const n = ledger.counts[f] ?? 0;
          const left = repaintsLeft(ledger, f);
          expect(left.job).toBe(MAX_JOB_REPAINTS - spent);
          expect(left.family).toBe(Math.min(MAX_JOB_REPAINTS - spent, MAX_FAMILY_REPAINTS - n));
          const refusal = repaintRefusal(ledger, f);
          expect(refusal).toBe(spent >= MAX_JOB_REPAINTS ? "job" : n >= MAX_FAMILY_REPAINTS ? "family" : undefined);
          if (n > 0) expect(repaintTag(ledger, f)).toBe(`r${n}`);
        }
      }),
    );
  });

  it("reads back as written (with answers), and refuses a ledger past a cap or with a malformed key", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ family, key }), { maxLength: 12 }), fc.boolean(), (asks, answer) => {
        let { ledger } = run(asks);
        if (answer) for (const [k, e] of Object.entries(ledger.keys)) ledger = settleRepaint(ledger, k, fc.sample(candidate(e.family), { numRuns: 1, seed: k.length })[0] as RepaintCandidate);
        expect(readRepaintLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
        expect(readRepaintLedger({ ...ledger, counts: { ...ledger.counts, joy: MAX_FAMILY_REPAINTS + 1 } })).toBeUndefined();
        expect(readRepaintLedger({ ...ledger, keys: { ...ledger.keys, "no!": { family: "joy", at: 1 } } })).toBeUndefined();
      }),
    );
    const full = { joy: 2, anger: 2, smug: 1 };
    expect(readRepaintLedger({ counts: full, keys: {} })).toBeUndefined();
  });

  it("a ledger in the job record is kept; an unreadable one refuses the job (it guards money)", () => {
    const job: ForgeJob = { jobId: "a".repeat(32), plane: "live", mode: "prompt", status: "done", createdAt: 0, repaints: reserveRepaint(undefined, "key-00000001", "joy", 9) };
    expect(parseForgeJob(JSON.stringify(job))?.repaints).toEqual(job.repaints);
    expect(parseForgeJob(JSON.stringify({ ...job, repaints: { counts: { joy: 3 }, keys: {} } }))).toBeUndefined();
  });
});

describe("readRepaintCandidate", () => {
  it("reads every on-contract candidate as written; ok exactly when it carries a face", () => {
    fc.assert(
      fc.property(family.chain(candidate), (c) => {
        expect(readRepaintCandidate(JSON.parse(JSON.stringify(c)))).toEqual(c);
        expect(readRepaintCandidate({ ...c, ok: !c.ok })).toBeUndefined();
      }),
    );
  });

  it("never throws and refuses missing files, paths, bad boxes and unknown families", () => {
    fc.assert(fc.property(fc.anything(), (v) => void readRepaintCandidate(v)));
    const good = { file: "head.joy_r1.png", bbox: [1, 2, 3, 4], mode: "over" };
    expect(readLayerPatch(good)).toEqual(good);
    for (const bad of [{ ...good, file: "../x.png" }, { ...good, file: "a/b.png" }, { ...good, bbox: [0, 0, 0, 4] }, { ...good, mode: "under" }, { ...good, narrowed: false }]) expect(readLayerPatch(bad)).toBeUndefined();
    const base = { family: "joy", ok: true, plane: "live", left: { family: 1, job: 3 }, patch: { layers: { head: good }, assets: {} } };
    expect(readRepaintCandidate(base)).toBeUndefined();
    expect(readRepaintCandidate({ ...base, patch: { layers: { head: good }, assets: { "head.joy_r1.png": "https://x/y.png" } } })).toBeDefined();
    expect(readRepaintCandidate({ ...base, family: "mood" })).toBeUndefined();
  });
});

describe("parseRepaintRequest", () => {
  it("keeps a family, a key, a trimmed eyes line and the hint; refuses the rest", () => {
    expect(parseRepaintRequest(JSON.stringify({ family: "joy", key: "key-00000001", eyes: "  carved   holes ", hint: "too_subtle" }))).toEqual({
      ok: true,
      value: { family: "joy", key: "key-00000001", eyes: "carved holes", hint: "too_subtle" },
    });
    expect(parseRepaintRequest(JSON.stringify({ family: "joy", key: "key-00000001", eyes: "   " }))).toEqual({ ok: true, value: { family: "joy", key: "key-00000001" } });
    for (const body of [{}, { family: "mood", key: "key-00000001" }, { family: "joy" }, { family: "joy", key: "k" }, { family: "joy", key: "key-00000001", eyes: 3 }, { family: "joy", key: "key-00000001", eyes: "x".repeat(201) }, { family: "joy", key: "key-00000001", hint: "louder" }]) {
      expect(parseRepaintRequest(JSON.stringify(body)).ok, JSON.stringify(body)).toBe(false);
    }
    expect(parseRepaintRequest("not json").ok).toBe(false);
  });
});

describe("toJobView's repaint window", () => {
  it("names when a live awake job expires, and nothing for replay or before awake", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 40 }), fc.constantFrom("live" as const, "replay" as const), fc.constantFrom("expressing" as const, "done" as const, "cutting" as const), (createdAt, plane, status) => {
        const view = toJobView({ jobId: "a".repeat(32), plane, mode: "prompt", status, createdAt, eyes: "edit" });
        expect(view.expiresAt).toBe(plane === "live" && status !== "cutting" ? createdAt + JOB_LIFETIME_MS : undefined);
      }),
    );
  });
});
