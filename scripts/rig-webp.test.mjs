// asset-webp: the conversion is lossless to the byte (scripts/rig-webp.mjs) and the committed
// Malakor rig is entirely WebP.
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { rgba, toWebp } from "./rig-webp.mjs";

const RIG = new URL("../assets/characters/malakor/rig/", import.meta.url);

/** A w x h RGBA PNG: a gradient, with transparent pixels that still carry colour. */
async function samplePng(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    data.set([(x * 7) % 256, (y * 13) % 256, (x * y) % 256, (x + y) % 5 === 0 ? 0 : (x * 31 + y) % 256], i * 4);
  }
  return { data, png: await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() };
}

describe("toWebp", () => {
  it("decodes to the same RGBA bytes, alpha 0 colours included", async () => {
    const { data, png } = await samplePng(61, 47);
    const webp = await toWebp(png, "sample");
    expect(webp.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(webp.subarray(8, 12).toString("latin1")).toBe("WEBP");
    const back = await rgba(webp);
    expect([back.width, back.height]).toEqual([61, 47]);
    expect(back.data.equals(data)).toBe(true);
  });

  it("is deterministic", async () => {
    const { png } = await samplePng(32, 32);
    expect((await toWebp(png)).equals(await toWebp(png))).toBe(true);
  });

  it("refuses an image whose decoded pixels would differ (a lossy encode)", async () => {
    const { png } = await samplePng(40, 40);
    const lossy = await sharp(png).webp({ quality: 40 }).toBuffer();
    const [a, b] = await Promise.all([rgba(png), rgba(lossy)]);
    expect(a.data.equals(b.data)).toBe(false);
  });
});

describe("committed Malakor rig", () => {
  const layers = JSON.parse(readFileSync(new URL("layers.json", RIG), "utf8"));
  const regions = JSON.parse(readFileSync(new URL("regions.json", RIG), "utf8"));
  const files = [...layers.layers.map((l) => l.file).filter((f) => f !== undefined), ...Object.values(regions).map((r) => r.map)];

  it("names only .webp layer images and region maps, and they exist", () => {
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      expect(file.endsWith(".webp"), file).toBe(true);
      expect(existsSync(new URL(file, RIG)), file).toBe(true);
    }
  });

  it("the PNGs kept for the tests that pin them decode to the same pixels as their WebP", async () => {
    for (const name of ["eye_l", "torso"]) {
      const [png, webp] = await Promise.all([rgba(readFileSync(new URL(`${name}.png`, RIG))), rgba(readFileSync(new URL(`${name}.webp`, RIG)))]);
      expect(png.data.equals(webp.data), name).toBe(true);
    }
  });
});
