// rig/A (challenge-2026-11-17) golden: the bad_shape text of the face, motion, turn and morph
// readers and checkMorph, captured BEFORE the section table (sections.ts) and the read
// kernel (read.ts) landed. Any drift in {code, path, message, layer} is a regression.
import { describe, expect, it } from "vitest";
import { golden } from "./golden.js";

describe("golden: section reader errors, byte for byte", () => {
  it("face, motion, turn", () => {
    expect(golden((r) => Object.assign(r, { face: 3, motion: [], turn: "x" }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.face: expected a face profile object",
          "path": "$.face",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.motion: when present, expected a motion object, got an array",
          "path": "$.motion",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.turn: when present, expected a turn object, got a string",
          "path": "$.turn",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { face: { gaze: { range: 5, habits: { chat: "x" } }, expression: { faces: { joy: "painted", ghost: "procedural" } } }, motion: { spring: 9 }, turn: { warp: -1, light: 2 } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.face.gaze.range: expected a number in [0, 1]",
          "path": "$.face.gaze.range",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.face.gaze.habits.chat: expected a number in [0, 1]",
          "path": "$.face.gaze.habits.chat",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.face.expression.faces.joy: expected "procedural"",
          "path": "$.face.expression.faces.joy",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.motion.spring: expected a number in [0, 2], got 9",
          "path": "$.motion.spring",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.turn.warp: expected a number in [0, 1], got -1",
          "path": "$.turn.warp",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.turn.light: expected a number in [0, 1], got 2",
          "path": "$.turn.light",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { face: { expression: { faces: [] } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.face.expression.faces: expected an object of family -> "procedural"",
          "path": "$.face.expression.faces",
        },
      ]
    `);
  });

  it("morph", () => {
    expect(golden((r) => Object.assign(r, { morph: 2 }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph: when present, expected a morph object, got 2",
          "path": "$.morph",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { morph: { layer: "", atlas: "../a", keys: [{ id: "A", track: "zz", at: 2, bbox: [0, 0, 1], cell: [-1, 0, 1, 1], flowMax: 300, part: "mid" }], eyes: 1, sway: { map: 3, amp: 99 }, mouthGain: { closed: 1, oo: 2, round: 2 } } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.layer: expected a layer name, got a string",
          "path": "$.morph.layer",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.atlas: "../a" must stay inside the rig folder (no .. segment)",
          "path": "$.morph.atlas",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.eyes: expected two [x, y] pairs of finite numbers, got 1",
          "path": "$.morph.eyes",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.sway.map: expected a file name, got 3",
          "path": "$.morph.sway.map",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.sway.amp: expected a number in (0, 12.8], got 99",
          "path": "$.morph.sway.amp",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.mouthGain.closed: closed is never reduced (the lips must meet on p, b, m)",
          "path": "$.morph.mouthGain.closed",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.mouthGain.oo: not a gainable mouth track (openWide, openMid, round, tongue, narrow)",
          "path": "$.morph.mouthGain.oo",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.mouthGain.round: expected a number in (0, 1], got 2",
          "path": "$.morph.mouthGain.round",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].part: when present, expected "upper" or "lower", got "mid"",
          "path": "$.morph.keys[0].part",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].id: expected an id matching ^[a-z0-9_]+$, got "A"",
          "path": "$.morph.keys[0].id",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].track: "zz" is not a track (joy, showman, anger, gloom, smug, suspicion, gazeL, gazeR, gazeU, gazeD, openWide, openMid, round, closed, teeth, tongue, narrow, blink)",
          "path": "$.morph.keys[0].track",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].at: when present, expected a number in (0, 1], got 2",
          "path": "$.morph.keys[0].at",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].bbox: expected a tuple of 4 integers, got an array",
          "path": "$.morph.keys[0].bbox",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].cell: expected x, y >= 0 and w, h > 0, got [-1, 0, 1, 1]",
          "path": "$.morph.keys[0].cell",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].flowMax: when present, expected a number in (0, 256], got 300",
          "path": "$.morph.keys[0].flowMax",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[0].flowCell: required with flowMax (omit both for a key without motion)",
          "path": "$.morph.keys[0].flowCell",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { morph: { layer: "body", atlas: "a.webp", keys: "x", eyes: [[1, 1], [2, 2]] } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys: expected 1..40 keys, got a string",
          "path": "$.morph.keys",
        },
      ]
    `);
    expect(golden((r) => Object.assign(r, { morph: { layer: "body", atlas: "a.webp", flow: "f.png", keys: [{ id: "a", track: "blink", bbox: [0, 0, 400, 1], cell: [0, 0, 1, 1] }, { id: "a", track: "blink", bbox: [0, 0, 1, 1], cell: [0, 0, 1, 1] }], eyes: [[-1, 1], [2, 2]] } }))).toMatchInlineSnapshot(`
      [
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.keys[1].at: keys[0] is already the blink stop at 1",
          "path": "$.morph.keys[1].at",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph.flow: no key has a flowCell (omit flow when no key moves)",
          "path": "$.morph.flow",
        },
      ]
    `);
  });

  it("every section at once, in contract order", () => {
    expect(golden((r) => Object.assign(r, { mouth: { cx: -1, lineY: 1, width: 1 }, face: 1, motion: 1, turn: 1, morph: 1 }))).toMatchInlineSnapshot(`
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
          "message": "$.face: expected a face profile object",
          "path": "$.face",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.motion: when present, expected a motion object, got 1",
          "path": "$.motion",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.turn: when present, expected a turn object, got 1",
          "path": "$.turn",
        },
        {
          "code": "bad_shape",
          "layer": undefined,
          "message": "$.morph: when present, expected a morph object, got 1",
          "path": "$.morph",
        },
      ]
    `);
  });
});
