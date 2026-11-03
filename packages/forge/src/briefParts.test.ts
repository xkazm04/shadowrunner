// cast-forge task 11 (requirement 4.4): the exact partsPromptFromBrief (pinned to design.md), the
// answer settled against the brief (fast-check: any motion the model sends comes out inside the
// rig's ranges), motion from the brief's words, the fill edit for named parts, and the job record.
import fc from "fast-check";
import { readMotion } from "@sr/rig";
import design from "../../../.kiro/specs/cast-forge/design.md?raw";
import ledger from "../../../docs/cast-forge-ledger.md?raw";
import { describe, expect, it } from "vitest";
import { briefPartLine, partsPromptFromBrief } from "./brief.js";
import { CLOSED_EYE, LIVE_AMP_MAX, fillPromptFromBrief, motionFromWords, settleBriefParts, settleMotion } from "./briefParts.js";
import { PART_ROLES, parseParts } from "./parts.js";
import { parseBriefPartsJson, parseForgeJob } from "./validate.js";
import type { ForgeJob } from "./job.js";
import type { NamedPart, PartRole } from "./types.js";
import type { CharacterBrief } from "./wire.js";

const BRIEF: CharacterBrief = {
  name: "Brine",
  one_line_request: "an iron diving helmet that hums sea shanties",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties between lines.",
  accent_hex: "#38c8ff",
  silhouette: "A round helmet with a glowing porthole and a hose curling up.",
  parts: [
    { name: "helmet", role: "head", what: "round iron helmet" },
    { name: "lip", role: "jaw", what: "hinged faceplate lip", motion: "drops with speech" },
    { name: "eye_l", role: "eye_l", what: "left porthole eye" },
    { name: "eye_r", role: "eye_r", what: "right porthole eye", motion: "blinks on its own" },
    { name: "hose", role: "float", what: "curling air hose", motion: "sways on its foot", follow: "helmet" },
    { name: "lamp", role: "pulse", what: "glowing porthole lamp", motion: "flickers" },
    { name: "suit", role: "torso", what: "canvas diving suit" },
  ],
  style: { name: "Low-poly 3D", why: "Planes cut cleanly." },
  portrait_prompt: "Low-poly planes. An iron diving helmet.",
};

const box: [number, number, number, number] = [100, 100, 300, 300];
const poly: [number, number][] = [[100, 100], [100, 300], [300, 300], [300, 100]];
const answered = (name: string, extra: Record<string, unknown> = {}) => ({ name, role: "accessory", box_2d: box, poly, ...extra });

describe("partsPromptFromBrief", () => {
  it("is the design.md text, verbatim, with the brief's name, style and parts", () => {
    const block = /### partsPromptFromBrief \(exact\)[\s\S]*?```text\n([\s\S]*?)\n```/.exec(design.replace(/\r\n/g, "\n"))?.[1];
    expect(block).toBeDefined();
    const lines = BRIEF.parts.map((p) => `${p.name} (${p.role}): ${p.what}${p.motion ? `; moves: ${p.motion}` : ""}${p.follow ? `; follows ${p.follow}` : ""}`);
    const expected = (block ?? "").split("\n").join(" ").replace("<name>", BRIEF.name).replace("<style>", BRIEF.style.name).replace("<parts>", lines.join(" | "));
    expect(partsPromptFromBrief(BRIEF)).toBe(expected);
  });

  it("names every planned part with its role, and folds in every prompt-rule heading of the ledger", () => {
    const prompt = partsPromptFromBrief(BRIEF);
    for (const part of BRIEF.parts) expect(prompt).toContain(briefPartLine(part));
    const general = ledger.replace(/\r\n/g, "\n").split("**Prompt rules (the parts model must be told)**")[1] ?? "";
    const headings = [...general.matchAll(/^- ([A-Z][a-z]+(?: [a-z]+)*?)(?::| are not)/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Outlines", "Cuts", "Follows", "Motion", "Mouth", "Keys and fills", "The fill edit", "Events"]);
    for (const h of ["Outlines:", "Cuts:", "Follows:", "Motion:", "Mouth:", "Keys and fills:", "Events are not motion"]) expect(prompt).toContain(h);
    // The fill-edit rule's parts-model half; its eyes-closed half is fillPromptFromBrief's.
    expect(prompt).toContain('a machine with a hollow takes cavity "gap" and fill "extend"');
  });
});

const anyNumber = fc.oneof(fc.double({ noNaN: false }), fc.integer({ min: -5000, max: 5000 }), fc.constant(Infinity));
const anyCurve = fc.record({ amp: fc.oneof(fc.tuple(anyNumber, anyNumber), anyNumber), freq: anyNumber, rot_deg: anyNumber, phase: anyNumber }, { requiredKeys: [] });
const anyMotion = fc.record({ float: anyCurve, pulse: anyCurve, blink: anyCurve }, { requiredKeys: [] });

describe("settleMotion", () => {
  it("anything the model sends comes out inside the rig's ranges, a blink only on an eye", () => {
    fc.assert(
      fc.property(anyMotion, fc.constantFrom(...PART_ROLES), (raw, role: PartRole) => {
        const motion = settleMotion(raw, role);
        if (motion === undefined) return true;
        const read = readMotion(motion, "$", { width: 1024, height: 1024 });
        const eye = role === "eye" || role === "eye_l" || role === "eye_r";
        return read.problems.length === 0 && (motion.blink === undefined || eye) && (motion.float?.amp.every((a) => a <= LIVE_AMP_MAX) ?? true);
      }),
    );
  });

  it("clamps out-of-range numbers instead of refusing them", () => {
    expect(settleMotion({ float: { amp: [400, -3], freq: 9, rot_deg: 40, phase: 1.25 }, pulse: { amp: 3, freq: 0 } }, "float")).toEqual({
      float: { amp: [LIVE_AMP_MAX, 3], freq: 2, rot_deg: 15, phase: 0.25 },
      pulse: { amp: 1, freq: 0.02 },
    });
    expect(settleMotion({ blink: { freq: 0.3 } }, "accessory")).toBeUndefined();
    expect(settleMotion({ float: { amp: "big", freq: 1 } }, "float")).toBeUndefined();
  });
});

describe("motionFromWords", () => {
  it("maps pulse, sway, float and blink words to safe defaults, deterministically", () => {
    expect(motionFromWords("lamp", "pulse", "flickers")?.pulse?.amp).toBe(0.5);
    expect(motionFromWords("lamp", "pulse", "flickers")?.pulse?.freq).toBeGreaterThan(1);
    expect(motionFromWords("hose", "float", "sways on its foot")?.float).toMatchObject({ amp: [0, 0], rot_deg: 4 });
    expect(motionFromWords("tag", "float", "Rise and settle with the breathing")?.float).toMatchObject({ amp: [1.5, 4] });
    expect(motionFromWords("eye_r", "eye_r", "blinks on its own")?.blink).toBeDefined();
    expect(motionFromWords("eye_r", "accessory", "blinks on its own")).toBeUndefined();
    expect(motionFromWords("a", "float", "drifts")).toEqual(motionFromWords("a", "float", "drifts"));
    expect(motionFromWords("a", "float", "drifts")?.float?.freq).not.toBe(motionFromWords("b", "float", "drifts")?.float?.freq);
  });

  it("an event clause, a jaw's speech and the plate roles give nothing", () => {
    expect(motionFromWords("head_tilt", "accessory", "turns toward the speaker")).toBeUndefined();
    expect(motionFromWords("glow", "pulse", "brightens as the jaw opens; floods when a vow is kept")?.pulse).toBeDefined();
    expect(motionFromWords("lip", "jaw", "drops with speech")).toBeUndefined();
    expect(motionFromWords("suit", "torso", "slow breathing")).toBeUndefined();
    expect(motionFromWords("helmet", "head", "tilts slowly")).toBeUndefined();
  });
});

describe("settleBriefParts and parseBriefPartsJson", () => {
  it("keeps only the brief's parts, with the brief's roles and follows, and role-gated fields where allowed", () => {
    const answer = {
      version: 2,
      cut: { feather: 1.4, cell: 99 },
      parts: [
        answered("helmet", { role: "crown", drop: 0.02, pivot: [1, 2] }),
        answered("lip", { drop: 0.5, glow: "#FFAA00", cavity: "gap" }),
        answered("eye_r", { motion: { blink: { freq: 0.3, phase: 0.2 } } }),
        answered("hose", { follow: "lamp", motion: { float: { amp: [2, 2], freq: 7 } } }),
        answered("lamp", { follow: "ghost", matte: "plate", pivot: [1200.4, -3] }),
        answered("ghost"),
        answered("suit", { fill: "extend", matte: "plate" }),
      ],
    };
    const { value, notes } = settleBriefParts(answer, BRIEF);
    const parsed = parseParts(value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const byName = new Map((parsed.value.named ?? []).map((p) => [p.name, p]));
    expect([...byName.keys()]).toEqual(["helmet", "lip", "eye_r", "hose", "lamp", "suit"]);
    expect(byName.get("helmet")).toEqual({ name: "helmet", role: "head", box_2d: box, poly });
    expect(byName.get("lip")).toMatchObject({ role: "jaw", drop: 0.1, glow: "#ffaa00", cavity: "gap" });
    expect(byName.get("hose")).toMatchObject({ role: "float", follow: "helmet", motion: { float: { amp: [2, 2], freq: 2 } } });
    expect(byName.get("lamp")).toMatchObject({ role: "pulse", matte: "plate", pivot: [1000, 0] });
    expect(byName.get("lamp")?.follow).toBeUndefined();
    expect(byName.get("lamp")?.motion?.pulse).toBeDefined(); // from "flickers"
    expect(byName.get("suit")).toEqual({ name: "suit", role: "torso", box_2d: box, poly });
    expect(parsed.value.cut).toEqual({ feather: 1, cell: 32 });
    expect(notes).toEqual(["dropped 1 part(s) the brief does not plan", "settled the motion of 1 part(s) into range", "motion from the brief's words for 1 part(s)"]);
  });

  it("reads a bare array as the parts, refuses bad outlines and non-JSON", () => {
    const ok = parseBriefPartsJson(JSON.stringify([answered("helmet"), answered("lip")]), BRIEF);
    expect(ok.ok && ok.value.named?.map((p) => p.role)).toEqual(["head", "jaw"]);
    const badPoly = parseBriefPartsJson(JSON.stringify({ version: 2, parts: [answered("helmet", { poly: [[1, 2]] })] }), BRIEF);
    expect(!badPoly.ok && badPoly.errors.syntax).toBe(false);
    const notJson = parseBriefPartsJson("SECRET {", BRIEF);
    expect(!notJson.ok && notJson.errors.syntax).toBe(true);
    expect(JSON.stringify(notJson)).not.toContain("SECRET");
    expect(parseBriefPartsJson(JSON.stringify({ version: 2, parts: [answered("ghost")] }), BRIEF).ok).toBe(false);
  });
});

describe("fillPromptFromBrief", () => {
  const part = (name: string, role: PartRole, extra: Partial<NamedPart> = {}): NamedPart => ({ name, role, box_2d: box, poly, ...extra });
  it("names the lifted parts the edit paints in the brief's words, eyes as shut lids", () => {
    const parts = [part("helmet", "head"), part("eye_r", "eye_r"), part("hose", "float"), part("lamp", "pulse", { fill: "extend" }), part("odd_bit", "accessory"), part("suit", "torso")];
    expect(fillPromptFromBrief(parts, BRIEF)).toBe(
      `Same image, same framing and lighting. Remove the right porthole eye ${CLOSED_EYE}, curling air hose, odd bit and paint the plausible surface that would be behind them. Change nothing else.`,
    );
    expect(fillPromptFromBrief([part("helmet", "head"), part("lamp", "pulse", { fill: "extend" })], BRIEF)).toBeUndefined();
  });
});

describe("parseForgeJob with named parts", () => {
  it("round-trips named parts and the decomposition; refuses a bad one", () => {
    const named = settleBriefParts({ version: 2, cut: { feather: 0 }, parts: [answered("helmet"), answered("hose", { motion: { float: { amp: [1, 1], freq: 0.3 } } })] }, BRIEF).value;
    const parsed = parseParts(named);
    if (!parsed.ok || parsed.value.named === undefined) throw new Error("fixture");
    const job: ForgeJob = {
      jobId: "j1",
      plane: "live",
      mode: "brief",
      status: "cutting",
      createdAt: 1,
      brief: BRIEF,
      named: { version: 2, parts: parsed.value.named, cut: { feather: 0 } },
      decomposition: "named",
    };
    expect(parseForgeJob(JSON.stringify(job))).toEqual(job);
    expect(parseForgeJob(JSON.stringify({ ...job, decomposition: "maybe" }))).toBeUndefined();
    expect(parseForgeJob(JSON.stringify({ ...job, named: { version: 2, parts: [] } }))).toBeUndefined();
  });
});
