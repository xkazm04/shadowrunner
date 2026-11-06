// The drawn mouth on pixel art and on a recoloured face (spark llm-avatar-lab R4, F3):
// (a) with `rig.mouth.cell` the mouth paints at one px per art pixel on the art's grid and is drawn
//     up unsmoothed, in canvas2d and in the GL quad (NEAREST); without it nothing changes;
// (b) the skin cover is sampled as the look recolours the art, so a recoloured face shows no patch
//     of raw skin.
import { defaultLook, poseLayers, regionKey, type Drive, type Layer, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createCanvas2dRenderer } from "../canvas2d/renderer.js";
import { createGlRenderer } from "../gl/renderer.js";
import { MOUTH_BOX } from "../mouth/anchor.js";
import { sampleArt, type MouthSurfaceFactory } from "../mouth/colours.js";
import { cellCrop, createMouthArt } from "../mouth/draw.js";
import { blendParams, restWeights } from "../mouth/shapes.js";
import type { MouthPose } from "../mouth/state.js";
import { createCanvasStub, createCtx2dStub, createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const stand = <T extends object>(value: object): T => value as T;

describe("cellCrop", () => {
  it("covers the mouth box and lands on whole cells of the canvas grid", () => {
    for (const [cx, lineY, width, cell] of [
      [515.5, 547, 89.25, 7.1],
      [300, 400, 110, 4],
      [10.3, 7.7, 5, 1],
    ] as const) {
      const a = cellCrop(cx, lineY, width, cell);
      expect(a.x / cell).toBeCloseTo(Math.round(a.x / cell), 6);
      expect(a.y / cell).toBeCloseTo(Math.round(a.y / cell), 6);
      expect(a.w).toBeCloseTo(a.cols * cell, 6);
      expect(a.h).toBeCloseTo(a.rows * cell, 6);
      expect(a.x).toBeLessThanOrEqual(cx - width * MOUTH_BOX.left + 1e-9);
      expect(a.x + a.w).toBeGreaterThanOrEqual(cx - width * MOUTH_BOX.left + width * MOUTH_BOX.width - 1e-9);
      expect(a.y).toBeLessThanOrEqual(lineY - width * MOUTH_BOX.up + 1e-9);
      expect(a.y + a.h).toBeGreaterThanOrEqual(lineY - width * MOUTH_BOX.up + width * MOUTH_BOX.height - 1e-9);
    }
  });
});

const plain = malakorRig();
const base: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, render: "drawn" } };
const pixel: Rig = { ...plain, mouth: { cx: 511.5, lineY: 511, width: 120, render: "drawn", cell: 8 } };
const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0.3, blink: 0 };
const pose = (alpha: number, open = 0.5): MouthPose => ({ params: { ...blendParams({ ...restWeights(), rest: 1 - open, openMid: open }), smile: 0.6 }, alpha, lips: 1 });

/** Surfaces that record their size and paint nothing, reading a solid skin colour back. */
function surfaces(): { factory: MouthSurfaceFactory; sizes: [number, number][] } {
  const sizes: [number, number][] = [];
  const factory: MouthSurfaceFactory = (w, h) => {
    sizes.push([w, h]);
    const g = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => undefined });
          if (prop === "getImageData") return (_x: number, _y: number, gw: number, gh: number) => ({ data: new Uint8ClampedArray(gw * gh * 4).fill(200) });
          return () => undefined;
        },
        set: () => true,
      },
    );
    return { canvas: stand<OffscreenCanvas>({ width: w, height: h }), g: stand<CanvasRenderingContext2D>(g) };
  };
  return { factory, sizes };
}

describe("canvas2d pixel mouth", () => {
  const run = (rig: Rig) => {
    const look = defaultLook(rig);
    const ctx2d = createCtx2dStub();
    const { canvas } = createCanvasStub({ webgl2: "null", ctx2d, width: 512, height: 512 });
    const s = surfaces();
    const renderer = createCanvas2dRenderer(canvas, ctx2d.ctx, rig, fakeAssets(rig), { mouthSurface: s.factory });
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 0, reducedMotion: false, mouth: pose(1) });
    return { ctx2d, s };
  };

  it("paints into a crop of one px per art pixel and draws it up with smoothing off", () => {
    const { ctx2d, s } = run(pixel);
    const area = cellCrop(511.5, 511, 120, 8);
    expect(s.sizes).toContainEqual([area.cols, area.rows]);
    expect(ctx2d.ctx.imageSmoothingEnabled).toBe(false);
    const crops = (ctx2d.images as { width?: number; height?: number }[]).filter((i) => i.width === area.cols && i.height === area.rows);
    expect(crops).toHaveLength(1);
  });

  it("without a cell the mouth stays smooth and paints straight on the context", () => {
    const { ctx2d, s } = run(base);
    expect(ctx2d.ctx.imageSmoothingEnabled).toBe(true);
    expect(s.sizes).not.toContainEqual([cellCrop(511.5, 511, 120, 8).cols, cellCrop(511.5, 511, 120, 8).rows]);
    expect(ctx2d.images).toHaveLength(poseLayers(base, defaultLook(base), DRIVE).length + 1);
  });
});

describe("WebGL pixel mouth", () => {
  const run = (rig: Rig) => {
    const look = defaultLook(rig);
    const stub = createGlStub();
    const { canvas } = createCanvasStub({ webgl2: stub, width: 512, height: 512 });
    const s = surfaces();
    const renderer = createGlRenderer(stub.gl, canvas, rig, fakeAssets(rig), undefined, s.factory);
    stub.reset();
    renderer.draw(poseLayers(rig, look, DRIVE), look, { t: 0, reducedMotion: false, mouth: pose(1) });
    return { stub, s };
  };
  const filters = (stub: ReturnType<typeof createGlStub>): unknown[] =>
    stub.log.filter(([name, args]) => name === "texParameteri" && (args[2] === stub.gl.NEAREST || args[2] === stub.gl.LINEAR)).map(([, args]) => args[2]);

  it("paints one texel per art pixel and samples NEAREST", () => {
    const { stub, s } = run(pixel);
    const area = cellCrop(511.5, 511, 120, 8);
    expect(s.sizes).toContainEqual([area.cols, area.rows]);
    expect(filters(stub)).toContain(stub.gl.NEAREST);
  });

  it("without a cell keeps the smooth LINEAR crop", () => {
    const { stub } = run(base);
    expect(filters(stub)).not.toContain(stub.gl.NEAREST);
  });
});

/** Surfaces with real pixels for solid fake images, so a sample can be read back. */
function pixelSurfaces(): MouthSurfaceFactory {
  type Buf = { width: number; height: number; buf: Uint8ClampedArray };
  return (w, h) => {
    const canvas: Buf = { width: w, height: h, buf: new Uint8ClampedArray(w * h * 4) };
    const put = (x: number, y: number, rgba: readonly number[]): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      canvas.buf.set(rgba, (y * w + x) * 4);
    };
    const g = {
      drawImage(src: { rgba?: number[]; buf?: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number, dw = src.width, dh = src.height) {
        for (let y = Math.max(0, Math.floor(dy)); y < Math.min(h, Math.ceil(dy + dh)); y += 1) {
          for (let x = Math.max(0, Math.floor(dx)); x < Math.min(w, Math.ceil(dx + dw)); x += 1) {
            if (src.rgba !== undefined) put(x, y, src.rgba);
            else if (src.buf !== undefined) {
              const sx = Math.min(src.width - 1, Math.floor(((x - dx) / dw) * src.width));
              const sy = Math.min(src.height - 1, Math.floor(((y - dy) / dh) * src.height));
              const i = (sy * src.width + sx) * 4;
              put(x, y, [src.buf[i] ?? 0, src.buf[i + 1] ?? 0, src.buf[i + 2] ?? 0, src.buf[i + 3] ?? 0]);
            }
          }
        }
      },
      getImageData: (_x: number, _y: number, gw: number, gh: number) => ({ data: canvas.buf.slice(0, gw * gh * 4), width: gw, height: gh }),
      putImageData: (d: { data: Uint8ClampedArray }) => canvas.buf.set(d.data),
    };
    return { canvas: stand<OffscreenCanvas>(canvas), g: stand<CanvasRenderingContext2D>(g) };
  };
}

describe("the skin cover follows the look's recolour", () => {
  const head: Layer = {
    name: "head",
    z: 1,
    kind: "head",
    file: "head.png",
    bbox: [0, 0, 200, 200],
    anchor: [100, 100],
    regions: { map: "head.regions.png", slots: [{ id: "skin", name: "skin", hex: "#c08060" }] },
  };
  const rig = stand<Rig>({
    version: 1,
    id: "t",
    name: "t",
    width: 200,
    height: 200,
    source: "forge",
    palette: { glow: "#ffffff", eye: "#ffffff", rim: "#ffffff", mouth: "#000000" },
    layers: [head],
    mouth: { cx: 100, lineY: 100, width: 60, render: "drawn" },
  });
  const assets = stand<Parameters<typeof sampleArt>[1]>({
    "head.png": { rgba: [192, 128, 96, 255], width: 200, height: 200 },
    // R = slot index + 1: the whole head is the skin slot.
    "head.regions.png": { rgba: [1, 0, 0, 255], width: 200, height: 200 },
  });
  const mouth = { cx: 100, lineY: 100, width: 60, render: "drawn" } as const;
  const look = (regions?: Record<string, string>): Look => ({ ...defaultLook(rig), ...(regions === undefined ? {} : { regions }) });

  it("a recoloured skin region changes the cover; no look or an unchanged look samples the raw art", () => {
    const factory = pixelSurfaces();
    const raw = sampleArt(rig, assets, mouth, factory);
    const same = sampleArt(rig, assets, mouth, factory, look());
    expect(raw?.skinTop).toEqual([192, 128, 96]);
    expect(same?.skinTop).toEqual(raw?.skinTop);
    const blue = sampleArt(rig, assets, mouth, factory, look({ [regionKey("head", "skin")]: "#2060ff" }));
    expect(blue).toBeDefined();
    const [r, , b] = blue?.skinTop ?? [0, 0, 0];
    expect(b).toBeGreaterThan(r + 40);
    expect(blue?.skinBottom[2]).toBeGreaterThan(blue?.skinBottom[0] ?? 255);
    // The lips and teeth are derived from the recoloured skin as well.
    expect(blue?.lip).not.toEqual(raw?.lip);
  });

  it("MouthArt.colours samples again for a new look, and caches per look", () => {
    const art = createMouthArt(pixelSurfaces());
    const a = look({ [regionKey("head", "skin")]: "#2060ff" });
    const first = art.colours(rig, assets, a);
    expect(art.colours(rig, assets, a)).toBe(first);
    const raw = art.colours(rig, assets);
    expect(raw).not.toBe(first);
    expect(raw?.skinTop).toEqual([192, 128, 96]);
  });
});
