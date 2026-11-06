// Rig.mouth (llm-avatar-lab, the rig owns the mouth): validateRig accepts the optional
// `{ cx, lineY, width }` and keeps it on the returned rig; a rig without it validates unchanged; a
// malformed one is `bad_shape` at `$.mouth` or `$.mouth.<field>`. serializeRig round-trips it.
// art-mouth: `render` "still" and the painted `lips` box (with its optional `seam`) are kept and round-trip too.
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

  it("keeps render: \"still\" (art-mouth's opt-out) and round-trips it", () => {
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "still" } }));
    expect(out.ok && out.value.mouth).toEqual({ cx: 300, lineY: 400, width: 110, render: "still" });
    if (out.ok) expect(JSON.parse(serializeRig(out.value)).mouth.render).toBe("still");
    for (const render of ["warp", "", null, 1, true]) expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, render } }))).toEqual(["bad_shape $.mouth.render"]);
  });

  it("keeps the painted lips (art-mouth), canvas edges included, dropping fields outside the contract", () => {
    const lips = { left: 250.5, right: 352, upper: 380, lower: 431.25 };
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips: { ...lips, extra: 1 } } }));
    expect(out.ok && out.value.mouth).toEqual({ cx: 300, lineY: 400, width: 110, lips });
    const edges = { left: 0, right: 1000, upper: 0, lower: 800 };
    const wide = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "still", lips: edges } }));
    expect(wide.ok && wide.value.mouth?.lips).toEqual(edges);
    const plain = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110 } }));
    expect(plain.ok && Object.keys(plain.value.mouth ?? {})).not.toContain("lips");
  });

  it("rejects lips that are not an object of finite numbers at $.mouth.lips", () => {
    for (const lips of [null, 3, "x", [250, 350, 380, 430], {}, { left: 250, right: 350, upper: 380 }, { left: "250", right: 350, upper: 380, lower: 430 }, { left: 250, right: Number.NaN, upper: 380, lower: 430 }, { left: 250, right: 350, upper: Number.NEGATIVE_INFINITY, lower: 430 }]) {
      expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips } }))).toEqual(["bad_shape $.mouth.lips"]);
    }
  });

  it("rejects lips that do not hold (cx, lineY) or leave the canvas, every case", () => {
    const base = { left: 250, right: 350, upper: 380, lower: 430 };
    const bad = [
      { left: 300 }, // left == cx
      { left: 320 }, // left right of cx
      { right: 300 }, // right == cx
      { right: 290 },
      { upper: 400 }, // upper == lineY
      { upper: 410 },
      { lower: 400 }, // lower == lineY
      { lower: 390 },
      { left: -1 }, // off the canvas
      { right: 1000.5 },
      { upper: -0.5 },
      { lower: 801 },
    ];
    for (const change of bad) expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips: { ...base, ...change } } }))).toEqual(["bad_shape $.mouth.lips"]);
  });

  it("keeps the seam (art-mouth: the parting at cx) inside [upper, lower], edges included, and omits it when absent", () => {
    for (const seam of [380, 412.5, 430]) {
      const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips: { left: 250, right: 350, upper: 380, lower: 430, seam } } }));
      expect(out.ok && out.value.mouth?.lips).toEqual({ left: 250, right: 350, upper: 380, lower: 430, seam });
    }
    const plain = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips: { left: 250, right: 350, upper: 380, lower: 430 } } }));
    expect(plain.ok && Object.keys(plain.value.mouth?.lips ?? {})).not.toContain("seam");
  });

  it("rejects a seam outside [upper, lower] or not finite at $.mouth.lips.seam", () => {
    for (const seam of [379, 430.5, Number.NaN, Number.POSITIVE_INFINITY, "410", null, -1]) {
      expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, lips: { left: 250, right: 350, upper: 380, lower: 430, seam } } }))).toEqual(["bad_shape $.mouth.lips.seam"]);
    }
  });

  it("round-trips lips through serializeRig and parseRigJson", () => {
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "still", cell: 2, lips: { left: 250, right: 350.5, upper: 380, lower: 430, seam: 411 } } }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const text = serializeRig(out.value);
    expect(Object.keys(JSON.parse(text).mouth as object)).toEqual(["cx", "lineY", "width", "render", "cell", "lips"]);
    expect(JSON.parse(text).mouth.lips).toEqual({ left: 250, right: 350.5, upper: 380, lower: 430, seam: 411 });
    const back = parseRigJson(text);
    expect(back.ok && back.value).toEqual(out.value);
  });

  it("keeps a pixel cell (finite > 0), rejects any other, and round-trips it", () => {
    const out = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110, render: "drawn", cell: 7.1 } }));
    expect(out.ok && out.value.mouth).toEqual({ cx: 300, lineY: 400, width: 110, render: "drawn", cell: 7.1 });
    if (out.ok) expect(parseRigJson(serializeRig(out.value)).ok && JSON.parse(serializeRig(out.value)).mouth.cell).toBe(7.1);
    for (const cell of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, "7", null]) {
      expect(paths(rig({ mouth: { cx: 300, lineY: 400, width: 110, cell } }))).toEqual(["bad_shape $.mouth.cell"]);
    }
    const plain = validateRig(rig({ mouth: { cx: 300, lineY: 400, width: 110 } }));
    expect(plain.ok && Object.keys(plain.value.mouth ?? {})).not.toContain("cell");
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
