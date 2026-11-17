/// <reference types="node" />
// rig/A (challenge-2026-11-17): one table of the optional Rig sections (sections.ts) derives the
// validator's read, the serializer's wire and readLook's subset, on one read kernel (read.ts).
// The golden block pins every sub-reader's error text, captured before the refactor.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXPRESSION_FAMILIES } from "../control.js";
import { FACE_FIELDS, FACE_LIMITS, withFaceValue, withRetired } from "../face.js";
import { defaultLook } from "../look.js";
import { MORPH_GAIN_TRACKS } from "../morph.js";
import { readLook } from "../readLook.js";
import { RIG_SECTIONS } from "../sections.js";
import { serializeRig } from "../serialize.js";
import type { Rig, RigFace, RigMorph, RigMotion, RigMouth, RigTurn } from "../types.js";
import { MORPH_KEYS, morphRig } from "./morphRig.js";

const CONTRACT = ["mouth", "face", "motion", "turn", "morph"];
const SRC = fileURLToPath(new URL("..", import.meta.url));
const sources = (): { file: string; text: string }[] =>
  readdirSync(SRC)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(`${SRC}/${file}`, "utf8") }));

/** `i / steps` of the way from `min` to `max`, both included, no -0. */
const grid = (min: number, max: number, steps = 400): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: steps }).map((i) => (i === steps ? max : min + ((max - min) * i) / steps));

const arbMouth: fc.Arbitrary<RigMouth> = fc
  .record({
    left: fc.integer({ min: 0, max: 200 }),
    a: fc.integer({ min: 1, max: 100 }),
    b: fc.integer({ min: 1, max: 100 }),
    upper: fc.integer({ min: 0, max: 200 }),
    c: fc.integer({ min: 1, max: 100 }),
    d: fc.integer({ min: 1, max: 100 }),
    width: fc.integer({ min: 1, max: 400 }),
    seam: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    render: fc.option(fc.constantFrom("drawn" as const, "still" as const), { nil: undefined }),
    cell: fc.option(fc.integer({ min: 1, max: 16 }), { nil: undefined }),
    lips: fc.boolean(),
    maw: fc.boolean(),
  })
  .map(({ left, a, b, upper, c, d, width, seam, render, cell, lips, maw }): RigMouth => {
    const [cx, lineY] = [left + a, upper + c];
    const lower = lineY + d;
    const at = seam === undefined ? undefined : upper + (seam % (lower - upper + 1));
    return {
      cx,
      lineY,
      width,
      ...(render === undefined ? {} : { render }),
      ...(cell === undefined ? {} : { cell }),
      ...(lips ? { lips: { left, right: cx + b, upper, lower, ...(at === undefined ? {} : { seam: at }), ...(maw ? { maw: true as const } : {}) } } : {}),
    };
  });

const arbFace: fc.Arbitrary<RigFace> = fc
  .tuple(fc.subarray([...FACE_FIELDS], { minLength: 1 }), fc.array(fc.integer({ min: 0, max: 400 }), { minLength: FACE_FIELDS.length, maxLength: FACE_FIELDS.length }), fc.subarray([...EXPRESSION_FAMILIES]))
  .map(([fields, steps, retired]) => {
    let face: RigFace = {};
    fields.forEach((field, i) => {
      const [min, max] = FACE_LIMITS[field];
      const step = steps[i] ?? 0;
      face = withFaceValue(face, field, step === 400 ? max : min + ((max - min) * step) / 400);
    });
    for (const family of retired) face = withRetired(face, family, true);
    return face;
  });

const arbMotion: fc.Arbitrary<RigMotion> = fc.record({ spring: grid(0, 2) }, { requiredKeys: [] });
const arbTurn: fc.Arbitrary<RigTurn> = fc.record({ warp: grid(0, 1), light: grid(0, 1) }, { requiredKeys: [] });
const baseMorph = (): RigMorph => {
  const morph = morphRig().morph;
  if (morph === undefined) throw new Error("morphRig has a morph");
  return morph;
};
const STILL_KEYS = MORPH_KEYS.filter((k) => k.flowCell === undefined);
const arbMorph: fc.Arbitrary<RigMorph> = fc
  .record({
    moving: fc.boolean(),
    sway: fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
    gain: fc.subarray([...MORPH_GAIN_TRACKS]),
    g: fc.integer({ min: 1, max: 100 }),
  })
  .map(({ moving, sway, gain, g }): RigMorph => {
    const { layer, atlas, flow, eyes } = baseMorph();
    return {
      layer,
      atlas,
      ...(moving && flow !== undefined ? { flow } : {}),
      keys: moving ? MORPH_KEYS : STILL_KEYS,
      eyes,
      ...(sway === undefined ? {} : { sway: { map: "morph.sway.png", amp: sway } }),
      ...(gain.length === 0 ? {} : { mouthGain: Object.fromEntries(gain.map((t) => [t, g / 100])) }),
    };
  });

const fullRig = (): Rig => ({ ...morphRig(), turn: { warp: 0.4 }, motion: { spring: 1.5 }, face: { motion: { breath: 0.2 }, gaze: { range: 0.5 } } });

describe("RIG_SECTIONS (one table of the optional Rig sections)", () => {
  it("serializeRig writes Rig.face in contract order (gaze before motion)", () => {
    const rig: Rig = { ...morphRig(), face: { motion: { breath: 0.2 }, gaze: { range: 0.5 } } };
    const face = (JSON.parse(serializeRig(rig)) as { face: Record<string, unknown> }).face;
    expect(Object.keys(face)).toEqual(["gaze", "motion"]);
  });

  it("lists the sections in contract order, and the serializer writes them in that order", () => {
    expect(Object.keys(RIG_SECTIONS)).toEqual(CONTRACT);
    const keys = Object.keys(JSON.parse(serializeRig(fullRig())) as Record<string, unknown>);
    expect(keys.slice(-CONTRACT.length)).toEqual(CONTRACT);
  });

  it("every section reads back what it wires (round trip per section)", () => {
    const run = <V>(s: { read: (v: unknown, path: string) => { value?: unknown; problems: unknown[] }; wire: (v: V) => unknown }, arb: fc.Arbitrary<V>, path: string): void => {
      fc.assert(
        fc.property(arb, (v) => {
          expect(s.read(s.wire(v), path)).toEqual({ value: v, problems: [] });
        }),
      );
    };
    run(RIG_SECTIONS.mouth, arbMouth, "$.mouth");
    run(RIG_SECTIONS.face, arbFace, "$.face");
    run(RIG_SECTIONS.motion, arbMotion, "$.motion");
    run(RIG_SECTIONS.turn, arbTurn, "$.turn");
    run(RIG_SECTIONS.morph, arbMorph, "$.morph");
  });

  it("architecture: one read kernel declares isRecord and describe/got", () => {
    const declares = (re: RegExp): string[] => sources().filter((s) => re.test(s.text)).map((s) => s.file);
    expect(declares(/\b(?:const|function)\s+isRecord\b/)).toEqual(["read.ts"]);
    expect(declares(/\b(?:const|function)\s+(?:describe|got)\b/)).toEqual(["read.ts"]);
  });

  it("architecture: no reader strips a path prefix back off a sub-reader message", () => {
    expect(sources().filter((s) => s.text.includes("slice(problem.path.length")).map((s) => s.file)).toEqual([]);
  });

  it("readLook drops a bad motion and turn, keeps the rest (guard)", () => {
    const valid = { ...defaultLook(morphRig()), face: { gaze: { range: 0.5 } } };
    const look = readLook({ ...valid, motion: { spring: 9 }, turn: { warp: 5 } });
    expect(look).toEqual(valid);
    expect(look === undefined ? [] : Object.keys(look)).not.toContain("motion");
    expect(look === undefined ? [] : Object.keys(look)).not.toContain("turn");
  });

  it("validate.ts has 80 lines of headroom under the 400-line cap", () => {
    const text = readFileSync(`${SRC}/validate.ts`, "utf8");
    expect(text.split("\n").length - (text.endsWith("\n") ? 1 : 0)).toBeLessThanOrEqual(320);
  });
});
