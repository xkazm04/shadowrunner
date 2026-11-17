// rig/A (challenge-2026-11-17) golden: the bad_shape text of the layer readers (motion, controls)
// and the mouth reader, captured BEFORE the section table (sections.ts) and the read
// kernel (read.ts) landed. Any drift in {code, path, message, layer} is a regression.
import { describe, expect, it } from "vitest";
import { golden } from "./golden.js";

describe("golden: layer and mouth reader errors, byte for byte", () => {
  it("layer motion and controls", () => {
    expect(golden((_, l) => Object.assign(l[2] ?? {}, { motion: { float: { amp: [1], freq: 9 }, pulse: 3, blink: { freq: 1 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].motion.float.amp: expected [x, y] canvas px, got an array",
          "path": "$.layers[2].motion.float.amp",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].motion.float.freq: expected a number in [0.02, 2], got 9",
          "path": "$.layers[2].motion.float.freq",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].motion.pulse: expected a pulse object, got 3",
          "path": "$.layers[2].motion.pulse",
        },
      ]
    `);
    expect(golden((_, l) => Object.assign(l[2] ?? {}, { motion: [] }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].motion: when present, expected a motion object, got an array",
          "path": "$.layers[2].motion",
        },
      ]
    `);
    expect(golden((_, l) => Object.assign(l[2] ?? {}, { variants: { joy: { file: "/x", bbox: [0, 0, 0, 1], mode: "x", narrowed: 1 }, bogus: {} }, regions: { map: 3, slots: [] }, socket: "s.png", tint: true }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].variants.joy.file: "/x" must be relative (no leading /)",
          "path": "$.layers[2].variants.joy.file",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].variants.joy.bbox[2]: width must be > 0, got 0",
          "path": "$.layers[2].variants.joy.bbox[2]",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].variants.joy.mode: expected "over" or "replace", got a string",
          "path": "$.layers[2].variants.joy.mode",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].variants.joy.narrowed: expected true (omit the field otherwise), got 1",
          "path": "$.layers[2].variants.joy.narrowed",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].variants.bogus: "bogus" is not an expression family (joy, showman, anger, gloom, smug, suspicion)",
          "path": "$.layers[2].variants.bogus",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.map: expected a file name, got 3",
          "path": "$.layers[2].regions.map",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots: expected 1..4 slots, got 0 slots",
          "path": "$.layers[2].regions.slots",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].socket: only an eye layer has a socket or closed art, this one is a string",
          "path": "$.layers[2].socket",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].tint: expected false (omit the field otherwise), got true",
          "path": "$.layers[2].tint",
        },
      ]
    `);
    expect(golden((_, l) => Object.assign(l[2] ?? {}, { regions: { map: "r.png", soft: 2, slots: [{ id: "A", name: "", hex: 1, shade: "x" }, 4] } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.soft: expected true (omit the field otherwise), got 2",
          "path": "$.layers[2].regions.soft",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots[0].shade: expected "move" (omit the field otherwise), got a string",
          "path": "$.layers[2].regions.slots[0].shade",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots[0].id: expected an id matching ^[a-z0-9_]+$, got "A"",
          "path": "$.layers[2].regions.slots[0].id",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots[0].name: expected a non-empty string, got a string",
          "path": "$.layers[2].regions.slots[0].name",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots[0].hex: expected a "#rrggbb" string, got 1",
          "path": "$.layers[2].regions.slots[0].hex",
        },
        {
          "code": "bad_shape",
          "layer": "head",
          "message": "$.layers[2].regions.slots[1]: expected a slot object, got 4",
          "path": "$.layers[2].regions.slots[1]",
        },
      ]
    `);
  });

  it("mouth and lips", () => {
    expect(golden((r) => Object.assign(r, { mouth: 3 }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth: when present, expected an object { cx, lineY, width }, got 3",
          "path": "$.mouth",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: -1, lineY: "x", width: 0 } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.cx: expected a number in [0, 256], got -1",
          "path": "$.mouth.cx",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lineY: expected a number in [0, 256], got a string",
          "path": "$.mouth.lineY",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.width: expected a finite number > 0, got 0",
          "path": "$.mouth.width",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, render: "bad" } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.render: when present, expected "drawn" or "still", got a string",
          "path": "$.mouth.render",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, cell: 0 } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.cell: when present, expected a finite number > 0, got 0",
          "path": "$.mouth.cell",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: 2 } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips: when present, expected an object { left, right, upper, lower } with 0 <= left < cx < right <= 256 and 0 <= upper < lineY < lower <= 256, got 2",
          "path": "$.mouth.lips",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: { left: 1, right: 20, upper: 1, lower: "z" } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips: an object { left, right, upper, lower } with 0 <= left < cx < right <= 256 and 0 <= upper < lineY < lower <= 256; a field is not a finite number",
          "path": "$.mouth.lips",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: { left: 12, right: 20, upper: 1, lower: 20 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips: an object { left, right, upper, lower } with 0 <= left < cx < right <= 256 and 0 <= upper < lineY < lower <= 256; got left 12, cx 10, right 20",
          "path": "$.mouth.lips",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: { left: 1, right: 20, upper: 11, lower: 20 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips: an object { left, right, upper, lower } with 0 <= left < cx < right <= 256 and 0 <= upper < lineY < lower <= 256; got upper 11, lineY 10, lower 20",
          "path": "$.mouth.lips",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: { left: 1, right: 20, upper: 1, lower: 20, seam: 30, maw: 1 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips.seam: when present, expected a finite number in [upper 1, lower 20], got 30",
          "path": "$.mouth.lips.seam",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 10, lineY: 10, width: 4, lips: { left: 1, right: 20, upper: 1, lower: 20, maw: false } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.lips.maw: when present, expected true, got false",
          "path": "$.mouth.lips.maw",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { mouth: { cx: 300, lineY: 10, width: 4, lips: { left: 1, right: 20, upper: 1, lower: 20 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.mouth.cx: expected a number in [0, 256], got 300",
          "path": "$.mouth.cx",
        },
      ]
    `);
  });
});
