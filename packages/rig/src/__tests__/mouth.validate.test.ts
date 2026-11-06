// Rig.mouth (llm-avatar-lab, the rig owns the mouth): validateRig accepts the optional
// `{ cx, lineY, width }` and keeps it on the returned rig; a rig without it validates unchanged; a
// malformed one is `bad_shape` at `$.mouth` or `$.mouth.<field>`. serializeRig round-trips it.
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import { parseRigJson, validateRig } from "../validate.js";

const rig = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  id: "m",
  name: "M",
  width: 1000,
  height: 800,
  source: "forge",
  fictional: true,
  palette: { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" },
  layers: [
    { name: "head", z: 0, kind: "head", file: "head.png", bbox: [100, 100, 400, 400], anchor: [300, 500] },
    { name: "jaw", z: 1, kind: "jaw", file: "jaw.png", bbox: [200, 400, 200, 100], anchor: [300, 400], follow: "head" },
  ],
  ...extra,
});

const paths = (input: unknown): (string | undefined)[] => {
  const out = validateRig(input);
  return out.ok ? [] : out.errors.map((e) => `${e.code} ${e.path}`);
};

describe("Rig.mouth", () => {
  it("is optional: a rig without it validates and gains no mouth key", () => {
    const out = validateRig(rig());
    expect(out.ok).toBe(true);
    if (out.ok) expect("mouth" in out.value).toBe(false);
  });

  it("is kept when well formed, edges of the canvas included", () => {
    for (const mouth of [{ cx: 300, lineY: 402.5, width: 110 }, { cx: 0, lineY: 800, width: 0.5 }, { cx: 1000, lineY: 0, width: 2000 }]) {
      const out = validateRig(rig({ mouth }));
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value.mouth).toEqual(mouth);
    }
  });

  it("drops fields outside the contract", () => {
    const out = validateRig(rig({ mouth: { cx: 1, lineY: 2, width: 3, extra: true } }));
    expect(out.ok && out.value.mouth).toEqual({ cx: 1, lineY: 2, width: 3 });
  });

  it("rejects a mouth that is not an object", () => {
    for (const mouth of [null, 3, "x", [1, 2, 3]]) expect(paths(rig({ mouth }))).toEqual(["bad_shape $.mouth"]);
  });

  it("rejects missing, non-finite, off-canvas or non-positive fields at their own path, every one", () => {
    expect(paths(rig({ mouth: {} }))).toEqual(["bad_shape $.mouth.cx", "bad_shape $.mouth.lineY", "bad_shape $.mouth.width"]);
    expect(paths(rig({ mouth: { cx: -1, lineY: 801, width: 0 } }))).toEqual(["bad_shape $.mouth.cx", "bad_shape $.mouth.lineY", "bad_shape $.mouth.width"]);
    expect(paths(rig({ mouth: { cx: 1001, lineY: Number.NaN, width: Number.POSITIVE_INFINITY } }))).toEqual(["bad_shape $.mouth.cx", "bad_shape $.mouth.lineY", "bad_shape $.mouth.width"]);
    expect(paths(rig({ mouth: { cx: "1", lineY: 2, width: -3 } }))).toEqual(["bad_shape $.mouth.cx", "bad_shape $.mouth.width"]);
  });

  it("keeps render: \"drawn\", rejects any other render, and round-trips it", () => {
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "drawn" } }));
    expect(out.ok && out.value.mouth).toEqual({ cx: 300, lineY: 400, width: 110, render: "drawn" });
    if (out.ok) expect(parseRigJson(serializeRig(out.value)).ok && JSON.parse(serializeRig(out.value)).mouth.render).toBe("drawn");
    expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "art" } }))).toContain("bad_shape $.mouth.render");
  });

  it("round-trips through serializeRig and parseRigJson, after the layers", () => {
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110 } }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const text = serializeRig(out.value);
    expect(Object.keys(JSON.parse(text) as object).slice(-2)).toEqual(["layers", "mouth"]);
    const back = parseRigJson(text);
    expect(back.ok && back.value).toEqual(out.value);
    const plain = validateRig(rig());
    expect(plain.ok && Object.keys(JSON.parse(serializeRig(plain.value)) as object)).not.toContain("mouth");
  });
});
