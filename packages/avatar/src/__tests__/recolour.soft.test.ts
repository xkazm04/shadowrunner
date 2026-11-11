// Soft region edges (companion-lanes round 5, `LayerRegions.soft`): a soft layer's map G is the
// pixel's coverage of the slot R names, and the slot's recolour is mixed over the pixel without it
// by that coverage, in recolour.ts (canvas2d) and the base fragment (every GL program). A layer
// without `soft` takes the old path exactly, whatever its map's G holds.
import { defaultLook, poseLayers, regionKey, type Drive, type Look, type Rig } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { baseFs } from "../gl/programs.js";
import { createRenderer } from "../gl/renderer.js";
import type { Rgb } from "../render/frame.js";
import { hexToHsl, layerRecolour, recolourPixels, recolourRgb, softMix, type IndexMap } from "../render/recolour.js";
import { createCanvasStub, createGlStub } from "./glStub.js";
import { asRigAssets, pixelAssets, pixelImage, pixelRig, ROBE_A, ROBE_B, type PixelImage } from "./pixels.js";

const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const GREEN = "#00ff00";

/** The pixel rig with its robe soft (or not), and a robe map whose G runs 0, 255, 128, 64 on x = 8..11. */
function softRig(soft: boolean): Rig {
  const rig = pixelRig();
  rig.layers = rig.layers.map((l) => (l.name === "robe" && l.regions !== undefined ? { ...l, regions: { ...l.regions, slots: l.regions.slots.map((s) => ({ ...s, shade: "move" as const })), ...(soft ? { soft: true as const } : {}) } } : l));
  return rig;
}
const COVER = [0, 255, 128, 64];
const softMap = (): PixelImage => pixelImage(16, 8, (x) => [x < 8 ? 1 : 2, x >= 8 && x < 12 ? (COVER[x - 8] ?? 255) : 255, 0, 255]);

/** Runs recolourPixels on the robe image (straight RGBA) with `rig`'s plan for `look`; returns the bytes. */
function robePixels(rig: Rig, look: Look, map: PixelImage = softMap()): Uint8ClampedArray {
  const robe = rig.layers.find((l) => l.name === "robe");
  if (robe === undefined) throw new Error("no robe");
  const plan = layerRecolour(rig, robe, look);
  if (plan === undefined) throw new Error("no plan");
  const image = pixelAssets()["robe.png"];
  const data = new Uint8ClampedArray(image?.pixels ?? []);
  const index: IndexMap = { data: map.pixels, width: map.width, height: map.height, rect: [0, 0, 1, 1] };
  recolourPixels(data, 16, 8, plan, index);
  return data;
}
const at = (data: Uint8ClampedArray, x: number, y = 3): number[] => Array.from(data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
const bytes = ([r, g, b]: Rgb, a = 255): number[] => [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a];
const unit = (rgba: readonly number[]): Rgb => [(rgba[0] ?? 0) / 255, (rgba[1] ?? 0) / 255, (rgba[2] ?? 0) / 255];

describe("softMix", () => {
  it("coverage 0 is the pixel without the slot, 1 the slot's result itself, between the per-channel mix", () => {
    const under: Rgb = [0.2, 0.4, 0.6];
    const over: Rgb = [0.9, 0.1, 0.3];
    expect(softMix(under, over, 0)).toEqual(under);
    expect(softMix(under, over, 1)).toBe(over);
    const half = softMix(under, over, 0.5);
    [0.55, 0.25, 0.45].forEach((v, i) => expect(half[i]).toBeCloseTo(v, 12));
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (c) => {
        softMix(under, over, c).forEach((v, i) => expect(v).toBeCloseTo((under[i] ?? 0) + ((over[i] ?? 0) - (under[i] ?? 0)) * c, 12));
      }),
    );
  });
});

describe("recolourPixels on a soft layer", () => {
  const rig = softRig(true);
  const look: Look = { ...defaultLook(rig), regions: { [regionKey("robe", "r2")]: GREEN } };
  const ref = hexToHsl(rig.layers[0]?.regions?.slots[1]?.hex ?? "")[2];
  const full = bytes(recolourRgb(unit(ROBE_B), GREEN, ref));

  it("the plan is soft and its key differs from the binary plan's", () => {
    const soft = layerRecolour(rig, rig.layers[0] ?? (undefined as never), look);
    const hard = layerRecolour(softRig(false), softRig(false).layers[0] ?? (undefined as never), look);
    expect(soft?.soft).toBe(true);
    expect(hard).not.toHaveProperty("soft");
    expect(soft?.key).not.toBe(hard?.key);
    // No slot on: no plan at all, soft or not (the old path).
    expect(layerRecolour(rig, rig.layers[0] ?? (undefined as never), defaultLook(rig))).toBeUndefined();
  });

  it("G 0 keeps the art, G 255 is the old result, G between is the mix (rounded once)", () => {
    const data = robePixels(rig, look);
    expect(at(data, 8)).toEqual([...ROBE_B]);
    expect(at(data, 9)).toEqual(full);
    for (const [x, g] of [[10, 128], [11, 64]] as const) {
      expect(at(data, x)).toEqual(bytes(softMix(unit(ROBE_B), recolourRgb(unit(ROBE_B), GREEN, ref), g / 255)));
    }
    expect(at(data, 12)).toEqual(full);
    expect(at(data, 2)).toEqual([...ROBE_A]); // slot 1 is off: untouched whatever its G
  });

  it("a layer without soft ignores G: every slot pixel is the old result (the cast's path, byte for byte)", () => {
    const hard = softRig(false);
    const data = robePixels(hard, { ...look });
    for (let x = 8; x < 16; x += 1) expect(at(data, x)).toEqual(full);
    const zeroG = robePixels(hard, { ...look }, pixelAssets()["robe.regions.png"]);
    expect(Array.from(data)).toEqual(Array.from(zeroG));
  });
});

describe("the GLSL soft path", () => {
  it("reads coverage from the same nearest texel as the slot, only on a soft layer, and mixes over the light's result or the art", () => {
    const fs = baseFs(false);
    for (const line of [
      "uniform float u_soft;",
      "vec4 texel = texture(u_map, clamp(muv, 0.0, 1.0));",
      "float slot = texel.r;",
      "if (u_soft > 0.5) cover = texel.g;",
      "if (cover < 1.0) over = mix(lit ? recolour(hsl, u_light.xyz, -1.0) : tex.rgb / tex.a, over, cover);",
      "rgb = over * tex.a;",
    ]) {
      expect(fs).toContain(line);
      expect(baseFs(true)).toContain(line);
      expect(baseFs(false, true)).toContain(line);
      expect(baseFs(false, false, { decl: "", sample: "  vec2 uv = v_uv;\n  vec4 tex = texture(u_tex, uv);" })).toContain(line);
    }
  });

  it("uploads u_soft 1 for a soft layer's recolour and 0 for a binary one", () => {
    for (const soft of [true, false]) {
      const stub = createGlStub();
      const rig = softRig(soft);
      const images = { ...pixelAssets(), "robe.regions.png": softMap() };
      const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 64, height: 64 }).canvas, rig, asRigAssets(images));
      const look: Look = { ...defaultLook(rig), regions: { [regionKey("robe", "r2")]: GREEN } };
      stub.reset();
      renderer.draw(poseLayers(rig, look, DRIVE), look);
      const calls = stub.log.filter(([name, args]) => name === "uniform1f" && (args[0] as { uniform?: string } | null)?.uniform === "u_soft").map(([, args]) => args[1]);
      expect(calls).toEqual([soft ? 1 : 0]);
    }
  });
});
