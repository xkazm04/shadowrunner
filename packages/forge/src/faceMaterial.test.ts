// forge-creator C3: the eyes line as one sentence (`eyesMaterial`), the retry decision (`faceRetry`),
// and the prompts it feeds. Golden: without an eyes line expressionPrompt, irisFreePrompt and
// closedEyesPrompt are byte-identical to the strings recorded before C3
// (test/fixtures/face-prompts.golden.json), for all six families and attempts 0..2.
import { EXPRESSION_FAMILIES } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import golden from "../test/fixtures/face-prompts.golden.json";
import { expressionPrompt } from "./expressions.js";
import { closedEyesPrompt, irisFreePrompt } from "./eyeArt.js";
import { MAX_EXTRA_EDITS, MAX_FACE_ATTEMPT, eyesMaterial, faceRetry, type FaceVerdict } from "./faceMaterial.js";

const GOLDEN: Readonly<Record<string, string>> = golden;
const NAMES = ["the Lantern Warden", "Brine"];
const STYLES = [undefined, "Low-poly 3D", "  "];

describe("prompts without an eyes line (golden)", () => {
  it("are byte-identical to before C3 for every family, attempt 0..2 and style", () => {
    let checked = 0;
    for (const name of NAMES)
      for (const style of STYLES) {
        const k = `${name}|${style ?? "-"}`;
        for (const material of [undefined, eyesMaterial(undefined), eyesMaterial("   ")]) {
          expect(irisFreePrompt(name, style, material)).toBe(GOLDEN[`iris|${k}`]);
          expect(closedEyesPrompt(name, style, material)).toBe(GOLDEN[`closed|${k}`]);
          for (const family of EXPRESSION_FAMILIES)
            for (const attempt of [0, 1, 2]) {
              expect(expressionPrompt(name, family, style, attempt, material)).toBe(GOLDEN[`expr|${family}|${attempt}|${k}`]);
              checked += 1;
            }
        }
      }
    expect(checked).toBe(NAMES.length * STYLES.length * 3 * EXPRESSION_FAMILIES.length * 3);
  });
});

describe("eyesMaterial", () => {
  it("is the full sentence the edits carry", () => {
    expect(eyesMaterial("a visor slit with star-white light behind it")).toBe(
      "Its eyes are a visor slit with star-white light behind it; keep them exactly that material and never paint human eyeballs, irises or eyelids on them.",
    );
  });

  it("drops a typed 'Its eyes are', trailing stops and blank lines", () => {
    expect(eyesMaterial("Its eyes are glass beads.")).toBe(eyesMaterial("glass beads"));
    expect(eyesMaterial("  glass\n beads ;. ")).toBe(eyesMaterial("glass beads"));
    expect(eyesMaterial("")).toBeUndefined();
    expect(eyesMaterial("Its eyes are ")).toBeUndefined();
  });

  it("with the line, the expression prompt and both eye prompts carry the sentence; the eye prompts drop the human frame", () => {
    const material = eyesMaterial("two triangular holes carved in a pumpkin, lit from inside") ?? "?";
    for (const family of EXPRESSION_FAMILIES)
      for (const attempt of [0, 1, 2]) expect(expressionPrompt("the Lantern Warden", family, "Flat poster", attempt, material)).toContain(material);
    const iris = irisFreePrompt("the Lantern Warden", "Flat poster", material);
    const closed = closedEyesPrompt("the Lantern Warden", "Flat poster", material);
    for (const p of [iris, closed]) {
      expect(p).toContain(material);
      expect(p.endsWith("The art style is Flat poster.")).toBe(true);
    }
    expect(iris).not.toContain("paint the white of the eye");
    expect(closed).not.toContain("paint the upper eyelids");
  });

  it("fast-check: any non-blank line gives one sentence that contains it once, trimmed, and never doubles the prefix", () => {
    const word = fc.stringMatching(/^[a-z][a-z ,'-]{0,40}[a-z]$/);
    fc.assert(
      fc.property(word, fc.boolean(), (line, prefixed) => {
        const out = eyesMaterial(prefixed ? `Its eyes are ${line}.` : line);
        const clean = line.replace(/\s+/g, " ");
        expect(out).toBe(`Its eyes are ${clean}; keep them exactly that material and never paint human eyeballs, irises or eyelids on them.`);
        expect(out?.match(/Its eyes are/g)).toHaveLength(1);
      }),
    );
  });
});

describe("faceRetry", () => {
  const verdict = fc.constantFrom<FaceVerdict>("ok", "refused", "skipped", "failed");

  it("re-runs a refusal at attempt + 1 until attempt 2 or four re-runs, then settles skipped", () => {
    expect(faceRetry("refused", { attempt: 0, extraEdits: 0 })).toEqual({ retry: true, attempt: 1 });
    expect(faceRetry("refused", { attempt: 1, extraEdits: 3 })).toEqual({ retry: true, attempt: 2 });
    expect(faceRetry("refused", { attempt: 2, extraEdits: 0 })).toEqual({ retry: false, outcome: "skipped" });
    expect(faceRetry("refused", { attempt: 0, extraEdits: MAX_EXTRA_EDITS })).toEqual({ retry: false, outcome: "skipped" });
    expect(faceRetry("skipped", { attempt: 0, extraEdits: 0 })).toEqual({ retry: false, outcome: "skipped" });
    expect(faceRetry("ok", { attempt: 1, extraEdits: 1 })).toEqual({ retry: false, outcome: "ok" });
  });

  it("fast-check: only a refusal under both caps retries, one attempt up; everything else settles as said", () => {
    fc.assert(
      fc.property(verdict, fc.nat(4), fc.nat(8), (v, attempt, extraEdits) => {
        const next = faceRetry(v, { attempt, extraEdits });
        const may = v === "refused" && attempt < MAX_FACE_ATTEMPT && extraEdits < MAX_EXTRA_EDITS;
        expect(next.retry).toBe(may);
        if (next.retry) expect(next.attempt).toBe(attempt + 1);
        else expect(next.outcome).toBe(v === "refused" ? "skipped" : v);
      }),
    );
  });

  it("fast-check: a forge driven by faceRetry spends at most 6 + MAX_EXTRA_EDITS edits, each family at most 3", () => {
    fc.assert(
      fc.property(fc.array(verdict, { minLength: 64, maxLength: 64 }), (verdicts) => {
        let edits = 0;
        let extraEdits = 0;
        let i = 0;
        for (let family = 0; family < 6; family += 1) {
          let attempt = 0;
          let perFamily = 0;
          for (;;) {
            edits += 1;
            perFamily += 1;
            if (attempt > 0) extraEdits += 1;
            const next = faceRetry(verdicts[i++ % verdicts.length] ?? "ok", { attempt, extraEdits });
            if (!next.retry) break;
            attempt = next.attempt;
          }
          expect(perFamily).toBeLessThanOrEqual(MAX_FACE_ATTEMPT + 1);
        }
        expect(edits).toBeLessThanOrEqual(6 + MAX_EXTRA_EDITS);
      }),
    );
  });
});
