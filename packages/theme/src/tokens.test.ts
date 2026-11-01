import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contrastRatio, mergeScales, parseHex, resolveRef, resolveTheme, themeCss, type Rgb } from "./tokens.ts";

const name = fc.stringMatching(/^[a-z][a-z0-9]{0,6}(?:-[a-z0-9]{1,4})?$/);
const rgb: fc.Arbitrary<Rgb> = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
);
const toHex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** A role vocabulary plus the subset a theme binds. */
const vocabulary = fc
  .uniqueArray(name, { minLength: 1, maxLength: 12 })
  .chain((roles) => fc.tuple(fc.constant(roles), fc.subarray(roles)));

const SCALES = { r: { v: "1rem" } };

describe("resolveTheme", () => {
  it("reports exactly the unbound roles, each by name, and resolves the rest", () => {
    fc.assert(
      fc.property(vocabulary, ([roles, bound]) => {
        const theme = Object.fromEntries(bound.map((role) => [role, "r.v"]));
        const { values, problems } = resolveTheme(roles, SCALES, theme, "t");
        const unbound = roles.filter((role) => !bound.includes(role));
        expect(problems).toEqual(unbound.map((role) => `t: role "${role}" is unbound`));
        expect([...values.keys()]).toEqual(roles.filter((role) => bound.includes(role)));
      }),
    );
  });

  it("names every theme key that is not in the vocabulary", () => {
    fc.assert(
      fc.property(fc.uniqueArray(name, { minLength: 2, maxLength: 12 }), fc.nat(), (keys, cut) => {
        const split = 1 + (cut % (keys.length - 1));
        const roles = keys.slice(0, split);
        const extras = keys.slice(split);
        const theme = Object.fromEntries(keys.map((key) => [key, "r.v"]));
        const { problems } = resolveTheme(roles, SCALES, theme, "t");
        expect(problems).toEqual(extras.map((key) => `t: "${key}" is not a role in roles.json`));
      }),
    );
  });

  it("names a role whose reference does not resolve", () => {
    const { values, problems } = resolveTheme(["a", "b"], SCALES, { a: "r.v", b: "r.missing" }, "t");
    expect(values.get("a")).toBe("1rem");
    expect(problems).toEqual(['t: role "b" -> "r.missing" does not resolve to a scale value']);
  });
});

describe("resolveRef", () => {
  it("finds every ramp step and nothing else", () => {
    const scalesArb = fc.dictionary(name, fc.dictionary(name, fc.string({ minLength: 1 }), { minKeys: 1 }), { minKeys: 1 });
    // Half the references point at a step that exists, half are random (almost always misses).
    const caseArb = scalesArb.chain((scales) => {
      const existing = Object.entries(scales).flatMap(([ramp, steps]) => Object.keys(steps).map((step) => [ramp, step] as const));
      return fc.tuple(fc.constant(scales), fc.oneof(fc.constantFrom(...existing), fc.tuple(name, name)));
    });
    fc.assert(
      fc.property(caseArb, ([scales, [ramp, step]]) => {
        const hit = Object.hasOwn(scales, ramp) && Object.hasOwn(scales[ramp] ?? {}, step);
        expect(resolveRef(scales, `${ramp}.${step}`)).toBe(hit ? scales[ramp]?.[step] : undefined);
      }),
    );
  });

  it("does not resolve prototype keys", () => {
    expect(resolveRef({ r: { v: "x" } }, "constructor.name")).toBeUndefined();
    expect(resolveRef({ r: { v: "x" } }, "r.toString")).toBeUndefined();
  });
});

describe("mergeScales", () => {
  it("keeps the first definition of a ramp and names both files of a duplicate", () => {
    const { scales, problems } = mergeScales([
      { source: "a.json", ramps: { soot: { "1": "#000000" } } },
      { source: "b.json", ramps: { soot: { "1": "#ffffff" }, paper: { "1": "#eeeeee" } } },
    ]);
    expect(scales).toEqual({ soot: { "1": "#000000" }, paper: { "1": "#eeeeee" } });
    expect(problems).toEqual(['ramp "soot" is defined in both a.json and b.json']);
  });
});

describe("themeCss", () => {
  it("declares every resolved role exactly once under [data-theme]", () => {
    fc.assert(
      fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 12 }), (roles) => {
        const values = new Map(roles.map((role, i) => [role, `${i}rem`]));
        const css = themeCss("t", values);
        expect(css).toContain('[data-theme="t"] {');
        for (const [role, value] of values) {
          expect(css.split(`  --sr-${role}: ${value};\n`)).toHaveLength(2);
        }
        expect(css.match(/--sr-/g)).toHaveLength(roles.length);
      }),
    );
  });
});

describe("contrast", () => {
  it("round-trips #rrggbb", () => {
    fc.assert(
      fc.property(rgb, (c) => {
        expect(parseHex(toHex(c))).toEqual(c);
      }),
    );
    expect(parseHex("#fff")).toBeUndefined();
    expect(parseHex("red")).toBeUndefined();
  });

  it("is symmetric, 1 for identical colours, and within [1, 21]", () => {
    fc.assert(
      fc.property(rgb, rgb, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeCloseTo(contrastRatio(b, a), 12);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
        expect(contrastRatio(a, a)).toBe(1);
      }),
    );
  });

  it("never drops when one colour moves towards white", () => {
    fc.assert(
      fc.property(rgb, rgb, fc.integer({ min: 0, max: 2 }), (fg, bg, channel) => {
        // Keep fg at least as light as bg, then lighten one fg channel further.
        if (contrastRatio(fg, [0, 0, 0]) < contrastRatio(bg, [0, 0, 0])) return;
        const lighter: [number, number, number] = [fg[0], fg[1], fg[2]];
        lighter[channel] = 255;
        expect(contrastRatio(lighter, bg)).toBeGreaterThanOrEqual(contrastRatio(fg, bg) - 1e-12);
      }),
    );
  });

  it("matches the WCAG reference points", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
    // #777777 on white is the textbook just-below-AA grey (4.48:1).
    expect(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255])).toBeCloseTo(4.48, 2);
  });
});
