import { describe, expect, it } from "vitest";
import { packErrorSentence, type PackErrorCode } from "../index.js";

const CODES: PackErrorCode[] = ["not_a_pack", "newer_version", "bad_manifest", "bad_rig", "bad_look", "missing_file", "too_large", "fetch_failed"];

describe("packErrorSentence", () => {
  it("gives every error code its own plain sentence", () => {
    const sentences = CODES.map((code) => packErrorSentence({ code, detail: "head.png" }));
    expect(new Set(sentences).size).toBe(CODES.length);
    for (const sentence of sentences) expect(sentence).toMatch(/^That .+\.$/);
  });

  it("names the missing image, or says an image when the detail is empty", () => {
    expect(packErrorSentence({ code: "missing_file", detail: "head.png" })).toBe("That pack is missing head.png.");
    expect(packErrorSentence({ code: "missing_file", detail: "" })).toBe("That pack is missing an image.");
  });
});
