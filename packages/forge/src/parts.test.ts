// forge-pipeline task 2.2: parseParts (requirements 3.2, 3.3; director ruling (b)), PART_KIND (3.4), toCanvas.
// Fixtures: the 2026-11-01 spike's recorded parts (polygons only, no image data), copied from
// var/forge-spike/<slug>/parts.json. Five of their polygons cross themselves; parsing keeps them.
// m8-parts.json is the recorded 2026-11-01 parts-only response on the Malakor portrait
// (ruling (a); provenance and its one-bracket repair in docs/decisions/0003-forge-spike.md).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import m8 from "../test/fixtures/m8-parts.json";
import announcer from "../test/fixtures/spike-announcer-of-dead-air-parts.json";
import lantern from "../test/fixtures/spike-lantern-warden-parts.json";
import understudy from "../test/fixtures/spike-understudy-parts.json";
import { MAX_PARTS, PART_KIND, POLY_MAX_POINTS, parseParts, toCanvas } from "./parts.js";
import { PART_NAMES, type Part, type PartName } from "./types.js";

const coord = fc.integer({ min: 0, max: 1000 });
const point = fc.tuple(coord, coord);

const arbPart = (name: PartName): fc.Arbitrary<Part> =>
  fc
    .record({
      ys: fc.tuple(coord, coord),
      xs: fc.tuple(coord, coord),
      poly: fc.array(point, { minLength: 3, maxLength: POLY_MAX_POINTS }),
    })
    .map(({ ys, xs, poly }) => ({
      name,
      box_2d: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)],
      poly,
    }));

/** A valid part set: `head` plus any subset of the other names, in any order. */
const arbParts: fc.Arbitrary<Part[]> = fc
  .subarray(PART_NAMES.filter((n) => n !== "head"))
  .chain((others) => fc.tuple(...["head" as const, ...others].map(arbPart)))
  .chain((parts) => fc.shuffledSubarray(parts, { minLength: parts.length }));

type Json = Record<string, unknown>;
const clone = (parts: Part[]): Json[] => parts.map((p) => ({ ...p, box_2d: [...p.box_2d], poly: p.poly.map((q) => [...q]) }));

const badCoord = fc.oneof(
  fc.constantFrom(-1, 1001, 999.5, 0.5), // just outside the boundaries
  fc.integer({ min: -100000, max: -1 }),
  fc.integer({ min: 1001, max: 100000 }),
  fc.double({ min: 0, max: 1000, noNaN: true }).filter((v) => !Number.isInteger(v)),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, "5", null, true),
);
const badName = fc.oneof(
  fc.string().filter((s) => !(PART_NAMES as readonly string[]).includes(s)),
  fc.constantFrom("Head", "eye", "mouth", 7, null),
);
const notObject = fc.constantFrom(null, 3, "head", [], [1, 2, 3], true);

/** One structural fault applied to a valid part set; each must make parseParts reject. */
const mutation: fc.Arbitrary<(parts: Json[]) => unknown> = fc.oneof(
  fc.tuple(fc.nat(), badName).map(([i, name]) => (ps: Json[]) => ps.map((p, j) => (j === i % ps.length ? { ...p, name } : p))),
  fc.tuple(fc.nat(), fc.nat({ max: 3 }), badCoord).map(([i, k, v]) => (ps: Json[]) => {
    const p = ps[i % ps.length];
    if (p !== undefined && Array.isArray(p.box_2d)) p.box_2d[k] = v;
    return ps;
  }),
  fc.tuple(fc.nat(), fc.nat(), fc.nat({ max: 1 }), badCoord).map(([i, k, axis, v]) => (ps: Json[]) => {
    const p = ps[i % ps.length];
    if (p !== undefined && Array.isArray(p.poly)) {
      const q: unknown = p.poly[k % p.poly.length];
      if (Array.isArray(q)) q[axis] = v;
    }
    return ps;
  }),
  fc.tuple(fc.nat(), fc.integer({ min: 0, max: 2 })).map(([i, n]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length ? { ...p, poly: Array.isArray(p.poly) ? p.poly.slice(0, n) : [] } : p)),
  ),
  fc.tuple(fc.nat(), fc.array(point, { minLength: POLY_MAX_POINTS + 1, maxLength: 80 })).map(([i, poly]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length ? { ...p, poly } : p)),
  ),
  fc.tuple(fc.nat(), fc.constantFrom([1], [1, 2, 3], "1,2")).map(([i, q]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length && Array.isArray(p.poly) ? { ...p, poly: [q, ...p.poly.slice(1)] } : p)),
  ),
  fc.tuple(fc.nat(), fc.constantFrom([0, 0, 0], [0, 0, 0, 0, 0], "0,0,0,0", null)).map(([i, b]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length ? { ...p, box_2d: b } : p)),
  ),
  fc.tuple(fc.nat(), fc.constantFrom([1000, 0, 0, 1000], [0, 1000, 1000, 0], [600, 600, 599, 600])).map(([i, b]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length ? { ...p, box_2d: b } : p)), // min > max
  ),
  fc.tuple(fc.nat(), fc.constantFrom("name", "box_2d", "poly")).map(([i, key]) => (ps: Json[]) =>
    ps.map((p, j) => (j === i % ps.length ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : p)),
  ),
  fc.tuple(fc.nat(), notObject).map(([i, junk]) => (ps: Json[]) => ps.map((p, j) => (j === i % ps.length ? junk : p))),
  // A malformed repeat at the front is inside the read window: repeats are lenient, shape is not.
  fc.nat().map((i) => (ps: Json[]) => [{ ...ps[i % ps.length], poly: [[1, 2]] }, ...ps]),
  fc.constant((ps: Json[]) => ps.filter((p) => p.name !== "head")), // no head
  fc.constant((ps: Json[]) => ({ parts: ps })), // wrapped, not an array
);

const arbAnyPart: fc.Arbitrary<Part> = fc.constantFrom(...PART_NAMES).chain(arbPart);

/** A valid part set with repeats mixed in (any names, any order), at most MAX_PARTS entries. */
const arbWithRepeats: fc.Arbitrary<Part[]> = fc
  .tuple(arbPart("head"), fc.array(arbAnyPart, { maxLength: MAX_PARTS - 1 }))
  .chain(([head, rest]) => fc.shuffledSubarray([head, ...rest], { minLength: rest.length + 1 }));

describe("parseParts", () => {
  it.each([
    ["Malakor (m8)", m8, ["crown", "head", "jaw", "eye_r", "eye_l", "monocle", "torso"]],
    ["Lantern Warden", lantern, ["hat", "eye_r", "eye_l", "jaw", "head", "torso"]],
    ["The Understudy", understudy, ["accessory", "eye_l", "eye_r", "jaw", "head", "torso"]],
    ["Announcer of Dead Air", announcer, ["crown", "hat", "head", "jaw", "eye_r", "eye_l", "torso"]],
  ])("accepts the recorded %s parts unchanged, without warnings", (_, fixture, names) => {
    const result = parseParts(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parts.map((p) => p.name).sort()).toEqual([...names].sort());
    expect(result.value).toEqual({ parts: fixture, warnings: [] });
  });

  it("property: every valid part set (head plus any others, any order) parses to itself", () => {
    fc.assert(
      fc.property(arbParts, (parts) => {
        expect(parseParts(clone(parts))).toEqual({ ok: true, value: { parts, warnings: [] } });
      }),
    );
  });

  it("property: a repeated name keeps the first occurrence and warns once per dropped repeat", () => {
    fc.assert(
      fc.property(arbWithRepeats, (input) => {
        const result = parseParts(clone(input));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const firsts = input.filter((p, i) => input.findIndex((q) => q.name === p.name) === i);
        expect(result.value.parts).toEqual(firsts);
        const repeatAt = input.flatMap((p, i) => (input.findIndex((q) => q.name === p.name) < i ? [`$[${i}].name`] : []));
        expect(result.value.warnings.map((w) => w.path)).toEqual(repeatAt);
      }),
      { numRuns: 300 },
    );
  });

  it("property: more than MAX_PARTS entries keeps the first MAX_PARTS, warns, and never reads the rest", () => {
    const window = fc
      .tuple(arbPart("head"), fc.array(arbAnyPart, { minLength: MAX_PARTS - 1, maxLength: MAX_PARTS - 1 }))
      .chain(([head, rest]) => fc.shuffledSubarray([head, ...rest], { minLength: MAX_PARTS }));
    const tail = fc.array(fc.oneof(arbAnyPart, fc.jsonValue()), { minLength: 1, maxLength: 30 });
    fc.assert(
      fc.property(window, tail, (kept, extra) => {
        const result = parseParts([...clone(kept), ...extra]);
        const alone = parseParts(clone(kept));
        expect(result.ok).toBe(true);
        expect(alone.ok).toBe(true);
        if (!result.ok || !alone.ok) return;
        expect(result.value.parts).toEqual(alone.value.parts);
        expect(result.value.warnings).toEqual([
          { path: "$", message: `has more than ${MAX_PARTS} parts; kept the first ${MAX_PARTS}` },
          ...alone.value.warnings,
        ]);
      }),
      { numRuns: 300 },
    );
  });

  it("repairs repeats and overflow with exact warnings", () => {
    const at = (name: string, y: number) => ({ name, box_2d: [y, 0, y, 0], poly: [[y, 0], [y, 1], [y, 2]] });
    const input = [at("head", 1), at("jaw", 2), at("head", 3), ...Array.from({ length: 8 }, (_, i) => at("crown", 10 + i))];
    expect(parseParts(input)).toEqual({
      ok: true,
      value: {
        parts: [at("head", 1), at("jaw", 2), at("crown", 10)],
        warnings: [
          { path: "$", message: "has more than 10 parts; kept the first 10" },
          { path: "$[2].name", message: "repeats part head; kept the first at $[0]" },
          ...[4, 5, 6, 7, 8, 9].map((i) => ({ path: `$[${i}].name`, message: "repeats part crown; kept the first at $[3]" })),
        ],
      },
    });
  });

  it("property: malformed inputs are rejected with code upstream", () => {
    fc.assert(
      fc.property(arbParts, mutation, (parts, mutate) => {
        const result = parseParts(mutate(clone(parts)));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.length).toBeGreaterThan(0);
        for (const error of result.errors) {
          expect(error.code).toBe("upstream");
          expect(error.path.startsWith("$")).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("property: arbitrary JSON never throws, and anything accepted holds only contract fields", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        const result = parseParts(json);
        if (!result.ok) return;
        const { parts } = result.value;
        for (const part of parts) expect(Object.keys(part)).toEqual(["name", "box_2d", "poly"]);
        expect(parts.some((p) => p.name === "head")).toBe(true);
        expect(new Set(parts.map((p) => p.name)).size).toBe(parts.length);
        expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
      }),
    );
  });

  it("property: error messages never echo the upstream value", () => {
    const marker = fc.string({ minLength: 1 }).map((s) => `zz-${s}`);
    fc.assert(
      fc.property(arbParts, marker, (parts, name) => {
        const result = parseParts(clone(parts).map((p) => (p.name === "head" ? { ...p, name } : p)));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        for (const error of result.errors) {
          expect(error.message).not.toContain(name);
          expect(error.path).not.toContain(name);
        }
      }),
    );
  });

  it("drops extra keys the model adds", () => {
    const head = { name: "head", box_2d: [1, 2, 3, 4], poly: [[1, 2], [3, 4], [5, 6]], label: "skull", confidence: 0.9 };
    expect(parseParts([head])).toEqual({
      ok: true,
      value: { parts: [{ name: "head", box_2d: [1, 2, 3, 4], poly: [[1, 2], [3, 4], [5, 6]] }], warnings: [] },
    });
  });

  it("rejects a set without head (requirement 3.3), and an empty set", () => {
    const jaw = { name: "jaw", box_2d: [1, 2, 3, 4], poly: [[1, 2], [3, 4], [5, 6]] };
    expect(parseParts([jaw])).toEqual({ ok: false, errors: [{ code: "upstream", path: "$", message: "has no head part" }] });
    expect(parseParts([])).toEqual({ ok: false, errors: [{ code: "upstream", path: "$", message: "has no head part" }] });
  });

  it("names the path of each fault", () => {
    const result = parseParts([
      { name: "head", box_2d: [1, 2, 3, 4], poly: [[1, 2], [3, 4], [5, 1001]] },
      { name: "crown", box_2d: [1, 2, 3], poly: [[1, 2], [3, 4], [5, 6]] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual(["$[0].poly[2]", "$[1].box_2d"]);
  });
});

describe("PART_KIND", () => {
  it("maps every part name per design.md", () => {
    expect(PART_KIND).toEqual({
      head: "head",
      jaw: "jaw",
      eye_l: "eye",
      eye_r: "eye",
      monocle: "accessory",
      hat: "accessory",
      accessory: "accessory",
      crown: "crown",
      hair: "crown",
      torso: "body",
    });
    expect(Object.keys(PART_KIND).sort()).toEqual([...PART_NAMES].sort());
  });
});

describe("toCanvas", () => {
  it("swaps [y, x] to [x, y] and scales 0..1000 to the canvas", () => {
    expect(toCanvas([[0, 0], [1000, 1000], [500, 250]], 1024, 1024)).toEqual([[0, 0], [1024, 1024], [256, 512]]);
    expect(toCanvas([[1000, 500]], 200, 100)).toEqual([[100, 100]]);
  });

  it("property: every point lands inside the canvas and scales back to the model point", () => {
    fc.assert(
      fc.property(fc.array(point, { maxLength: 60 }), fc.integer({ min: 1, max: 4096 }), fc.integer({ min: 1, max: 4096 }), (poly, w, h) => {
        const px = toCanvas(poly, w, h);
        expect(px).toHaveLength(poly.length);
        px.forEach(([x, y], i) => {
          const [my, mx] = poly[i] ?? [0, 0];
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(h);
          expect((x * 1000) / w).toBeCloseTo(mx, 6);
          expect((y * 1000) / h).toBeCloseTo(my, 6);
        });
      }),
    );
  });
});
