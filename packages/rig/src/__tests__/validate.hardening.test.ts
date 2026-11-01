// rig-core task 3.0: hardening from the task 2 review. One fault property per rule, plus the
// acceptance side of each rule so a fix cannot simply reject everything.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { serializeRig } from "../serialize.js";
import type { Layer, Rig } from "../types.js";
import { parseRigJson, validateRig, type RigError } from "../validate.js";
import { arbRelativeFile, nth, rigArb } from "./arb.js";

function errorsOf(result: ReturnType<typeof validateRig>): RigError[] {
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

const withLayer = (rig: Rig, i: number, change: (layer: Layer) => Layer): Rig => ({
  ...rig,
  layers: rig.layers.map((l, j) => (j === i ? change(l) : l)),
});

/** Inserts `piece` into `text` at a position chosen by `at`. */
const insertAt = (text: string, piece: string, at: number): string => {
  const k = at % (text.length + 1);
  return text.slice(0, k) + piece + text.slice(k);
};

describe("parseRigJson", () => {
  it("parses every serialized rig back to the same rig", () => {
    fc.assert(
      fc.property(rigArb(), (rig) => {
        expect(parseRigJson(serializeRig(rig))).toEqual({ ok: true, value: rig });
      }),
    );
  });

  it("reports text that is not JSON as one bad_shape at $", () => {
    const truncated = fc
      .tuple(rigArb(), fc.nat())
      .map(([rig, cut]) => {
        const text = serializeRig(rig);
        return text.slice(0, cut % text.length);
      });
    const notJson = fc.string().filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    });
    fc.assert(
      fc.property(fc.oneof(truncated, notJson), (text) => {
        const errors = errorsOf(parseRigJson(text));
        expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", "$"]]);
        expect(errors[0]?.message).toMatch(/JSON/);
      }),
    );
  });

  it("hands well-formed JSON to validateRig unchanged", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(parseRigJson(JSON.stringify(value))).toEqual(validateRig(JSON.parse(JSON.stringify(value))));
      }),
    );
  });
});

describe("validateRig: canvas size", () => {
  const notPositiveInteger = fc.oneof(
    fc.integer({ max: 0 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d)),
  );

  it("rejects a width or height that is not a positive integer with one bad_shape", () => {
    fc.assert(
      fc.property(rigArb(), fc.constantFrom("width", "height"), notPositiveInteger, (rig, key, value) => {
        const errors = errorsOf(validateRig({ ...rig, [key]: value }));
        expect(errors.map((e) => [e.code, e.path])).toEqual([["bad_shape", `$.${key}`]]);
      }),
    );
  });
});

describe("validateRig: layer file paths", () => {
  const bad = fc.oneof(
    arbRelativeFile.map((f) => `/${f}`),
    fc.tuple(arbRelativeFile, fc.nat()).map(([f, at]) => {
      const parts = f.split("/");
      parts.splice(at % (parts.length + 1), 0, "..");
      return parts.join("/");
    }),
    fc.tuple(arbRelativeFile, fc.nat()).map(([f, at]) => insertAt(f, ":", at)),
    fc.tuple(arbRelativeFile, fc.nat()).map(([f, at]) => insertAt(f, "\\", at)),
    // An empty segment anywhere after the first: `a//b`, `a/` (the leading `/` case is above).
    fc.tuple(arbRelativeFile, fc.nat()).map(([f, at]) => {
      const parts = f.split("/");
      parts.splice(1 + (at % parts.length), 0, "");
      return parts.join("/");
    }),
    fc.constantFrom(
      "",
      "a//b.png",
      "parts/",
      "./",
      "data:image/png;base64,",
      "/etc/passwd",
      "../secret.png",
      "a/../../b.png",
      "..",
      "C:\\rig\\head.png",
      "C:/rig/head.png",
      "file:///etc/passwd",
      "https://example.invalid/head.png",
      "javascript:alert(1)",
      "data:text/html;base64,PGgxPg==",
      "head\\..\\..\\x.png",
    ),
  );

  it("rejects a file that is empty, absolute, climbs out, has an empty segment, carries a scheme or uses a backslash", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), bad, (rig, pick, file) => {
        const i = pick % rig.layers.length;
        const errors = errorsOf(validateRig(withLayer(rig, i, (l) => ({ ...l, file }))));
        expect(errors.map((e) => [e.code, e.path, e.layer])).toEqual([["bad_shape", `$.layers[${i}].file`, nth(rig.layers, i).name]]);
      }),
    );
  });

  it("accepts relative POSIX paths inside the folder and PNG data: URLs from the forge", () => {
    const good = fc.oneof(
      arbRelativeFile,
      fc.constantFrom("head.png", "parts/eye_l.png", "./jaw.png", "a/./b.png", "..png", "a..b/c.png", "data:image/png;base64,iVBORw0KGgo="),
    );
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), good, (rig, pick, file) => {
        const i = pick % rig.layers.length;
        const fixed = withLayer(rig, i, (l) => ({ ...l, file }));
        expect(validateRig(fixed)).toEqual({ ok: true, value: fixed });
      }),
    );
  });
});

describe("validateRig: bbox edge tolerance", () => {
  const within = fc.double({ min: 0, max: 0.999e-6, noNaN: true });
  const beyond = fc.double({ min: 1.001e-6, max: 1000, noNaN: true });
  const farEdge = fc.constantFrom("right", "bottom");

  const overshoot = (rig: Rig, i: number, edge: "right" | "bottom", e: number): Rig =>
    withLayer(rig, i, (l) => {
      const [x, y, w, h] = l.bbox;
      return { ...l, bbox: edge === "right" ? [x, y, rig.width - x + e, h] : [x, y, w, rig.height - y + e] };
    });

  it("accepts a right or bottom edge up to 1e-6 px past the canvas", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), farEdge, within, (rig, pick, edge, e) => {
        const nudged = overshoot(rig, pick % rig.layers.length, edge, e);
        expect(validateRig(nudged)).toEqual({ ok: true, value: nudged });
      }),
    );
  });

  it("rejects a right or bottom edge more than 1e-6 px past the canvas", () => {
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), farEdge, beyond, (rig, pick, edge, e) => {
        const i = pick % rig.layers.length;
        const errors = errorsOf(validateRig(overshoot(rig, i, edge, e)));
        expect(errors.map((x) => [x.code, x.layer])).toEqual([["bbox_out_of_bounds", nth(rig.layers, i).name]]);
      }),
    );
  });

  it("gives the left and top edges no tolerance", () => {
    const tiny = fc.double({ min: 1e-12, max: 0.999e-6, noNaN: true });
    fc.assert(
      fc.property(rigArb({ minLayers: 1 }), fc.nat(), fc.constantFrom("left", "top"), tiny, (rig, pick, edge, e) => {
        const i = pick % rig.layers.length;
        const broken = withLayer(rig, i, (l) => {
          const [x, y, w, h] = l.bbox;
          return { ...l, bbox: edge === "left" ? [-e, y, w, h] : [x, -e, w, h] };
        });
        const errors = errorsOf(validateRig(broken));
        expect(errors.map((x) => [x.code, x.layer])).toEqual([["bbox_out_of_bounds", nth(rig.layers, i).name]]);
      }),
    );
  });
});
