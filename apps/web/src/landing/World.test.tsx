import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  bandOf,
  CABINET_TOP,
  fitWorld,
  HEADER_HEIGHT,
  PORTRAIT_BELOW,
  SET_PLATE,
  World,
  WORLD_SIZE,
  type WorldLayout,
} from "./World";
import { PLATE } from "./superellipse";

const side = fc.double({ min: 1, max: 10_000, noNaN: true, noDefaultInfinity: true });
const EPS = 1e-9;

describe("fitWorld", () => {
  it("uses the portrait world exactly when the stage is narrower than 0.78", () => {
    // Aspects drawn around the threshold, so a shifted cut-off is found.
    const aspect = fc.oneof(fc.double({ min: 0.6, max: 0.95, noNaN: true }), fc.constant(PORTRAIT_BELOW));
    fc.assert(
      fc.property(side, aspect, (vh, a) => {
        const vw = vh * a;
        const fit = fitWorld(vw, vh);
        expect(fit.layout).toBe(vw / vh < PORTRAIT_BELOW ? "portrait" : "landscape");
        expect({ width: fit.width, height: fit.height }).toEqual(WORLD_SIZE[fit.layout]);
      }),
    );
  });

  it("scales the world as a unit to fit, touching the stage on one axis, centred, never clipped", () => {
    fc.assert(
      fc.property(side, side, (vw, vh) => {
        const { width, height, scale, x, y } = fitWorld(vw, vh);
        const w = width * scale;
        const h = height * scale;
        expect(scale).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(vw * (1 + EPS));
        expect(h).toBeLessThanOrEqual(vh * (1 + EPS));
        expect(Math.abs(w - vw) <= vw * EPS || Math.abs(h - vh) <= vh * EPS).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-vw * EPS);
        expect(y).toBeGreaterThanOrEqual(-vh * EPS);
        expect(x * 2 + w).toBeCloseTo(vw, 6);
        expect(y * 2 + h).toBeCloseTo(vh, 6);
      }),
    );
  });

  it("holds the supported sizes (requirement 9.1)", () => {
    expect(fitWorld(1600, 900)).toEqual({ layout: "landscape", width: 1600, height: 900, scale: 1, x: 0, y: 0 });
    expect(fitWorld(1280, 800)).toMatchObject({ layout: "landscape", scale: 0.8, x: 0, y: 40 });
    expect(fitWorld(2560, 1440)).toMatchObject({ layout: "landscape", scale: 1.6, x: 0, y: 0 });
    const phone = fitWorld(390, 844);
    expect(phone).toMatchObject({ layout: "portrait", width: 420, height: 910 });
    expect(phone.scale).toBeCloseTo(844 / 910, 9);
  });

  it("collapses a missing or broken stage to scale 0 instead of NaN", () => {
    for (const [vw, vh] of [
      [0, 0],
      [Number.NaN, 900],
      [1600, Number.POSITIVE_INFINITY],
      [-5, 900],
    ] as const) {
      const fit = fitWorld(vw, vh);
      expect(fit.scale).toBe(0);
      expect(Number.isNaN(fit.x) || Number.isNaN(fit.y)).toBe(false);
    }
  });
});

describe("bandOf", () => {
  it("names the empty band on the axis the world does not fill, and none when it fills both", () => {
    fc.assert(
      fc.property(side, side, (vw, vh) => {
        const fit = fitWorld(vw, vh);
        const band = bandOf(fit);
        if (band === "pillar") expect(fit.x).toBeGreaterThan(0.5);
        else if (band === "letter") expect(fit.y).toBeGreaterThan(0.5);
        else {
          expect(fit.x).toBeLessThanOrEqual(0.5);
          expect(fit.y).toBeLessThanOrEqual(0.5);
        }
      }),
    );
    expect(bandOf(fitWorld(1600, 900))).toBeUndefined();
    expect(bandOf(fitWorld(1280, 800))).toBe("letter");
    expect(bandOf(fitWorld(1600, 841))).toBe("pillar");
  });
});

describe("set placement (landing task 5.0)", () => {
  const LAYOUTS: readonly WorldLayout[] = ["landscape", "portrait"];

  it("keeps the portrait header to two rows: at most 96 world px", () => {
    expect(HEADER_HEIGHT.portrait).toBeLessThanOrEqual(96);
    expect(HEADER_HEIGHT.landscape).toBeLessThanOrEqual(HEADER_HEIGHT.portrait);
  });

  it.each(LAYOUTS)("%s: the cabinet starts directly below the header, never under it", (layout) => {
    const { scale, y } = SET_PLATE[layout];
    const top = y + CABINET_TOP * scale;
    expect(top).toBeGreaterThanOrEqual(HEADER_HEIGHT[layout]);
    expect(top - HEADER_HEIGHT[layout]).toBeLessThanOrEqual(24);
  });

  it.each(LAYOUTS)("%s: the plate is centred on the world and fits its width", (layout) => {
    const { scale, x } = SET_PLATE[layout];
    const world = WORLD_SIZE[layout];
    // The reference centres the glass, not the plate, so the plate centre may sit 2 px off.
    expect(Math.abs(x + (PLATE.width / 2) * scale - world.width / 2)).toBeLessThanOrEqual(2);
    if (layout === "portrait") {
      // The cabinet (plate x 249..949) stays inside the narrow world.
      expect(x + 249 * scale).toBeGreaterThanOrEqual(0);
      expect(x + 949 * scale).toBeLessThanOrEqual(world.width);
    }
  });
});

describe("World", () => {
  it("renders the landscape world at 1:1 before the stage is measured", () => {
    const html = renderToString(
      <World>
        <p>inside</p>
      </World>,
    );
    expect(html).toContain('data-world="landscape"');
    expect(html).toMatch(/width:1600px;height:900px;transform:translate\(0px, 0px\) scale\(1\)/);
    expect(html).toContain("<p>inside</p>");
  });
});
