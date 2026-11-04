// asset-webp amendment (docs/rig-format.md "Layer files"): `file` also accepts a `.webp` path and a
// `data:image/webp;base64,` URL; every other data: type is still refused; the format stays version 1.
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import { parseRigJson, validateRig } from "../validate.js";

const rig = (file: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: "w",
  name: "W",
  width: 100,
  height: 100,
  source: "replay",
  fictional: true,
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers: [{ name: "head", z: 0, kind: "head", file, bbox: [0, 0, 50, 50], anchor: [25, 25], ...extra }],
});

describe("webp layer files", () => {
  it.each(["head.webp", "parts/eye_l.webp", "data:image/webp;base64,UklGRg==", "data:image/png;base64,iVBORw0KGgo="])("accepts %s", (file) => {
    expect(validateRig(rig(file)).ok).toBe(true);
  });

  it("accepts a webp variant patch and region map", () => {
    const checked = validateRig(
      rig("head.webp", {
        variants: { joy: { file: "head.joy.webp", bbox: [0, 0, 10, 10], mode: "over" } },
        regions: { map: "head.regions.webp", slots: [{ id: "r1", name: "hood", hex: "#336699" }] },
      }),
    );
    expect(checked.ok).toBe(true);
  });

  it.each([
    "data:image/webp;base64,",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/gif;base64,R0lGOD",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/webp,UklGRg==",
    "data:text/html;base64,PGgxPg==",
    "https://example.invalid/head.webp",
  ])("rejects %s at the file path", (file) => {
    const checked = validateRig(rig(file));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", "$.layers[0].file"]]);
  });

  it("round-trips through serializeRig unchanged", () => {
    const first = validateRig(rig("data:image/webp;base64,UklGRg=="));
    if (!first.ok) throw new Error("rig did not validate");
    const text = serializeRig(first.value);
    const again = parseRigJson(text);
    if (!again.ok) throw new Error("serialized rig did not parse");
    expect(again.value).toEqual(first.value);
    expect(serializeRig(again.value)).toBe(text);
  });
});
