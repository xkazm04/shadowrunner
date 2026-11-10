// perfection-pass task 12: served cast art as lossy WebP (scripts/art-webp.mjs). The encode keeps
// alpha byte for byte, region maps stay bit-exact, and every committed cast character passes its
// geometry check on the WebP; Malakor's house art is never re-encoded.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { artSlugs, checkJob, FORGE_DIR, KEEP_PNG, mouthBox, servedElsewhere, TOLERANCE, toArtWebp, ZONES } from "./art-webp.mjs";
import { rgba } from "./rig-webp.mjs";

/** A w x h RGBA PNG of soft paint (a lossy encode's case) with a feathered alpha edge. */
async function paintPng(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const r = Math.hypot(x - w / 2, y - h / 2);
    data.set([120 + Math.round(60 * Math.sin(x / 9)), 90 + Math.round(40 * Math.cos(y / 7)), 70 + ((x + y) % 3), Math.max(0, Math.min(255, Math.round((w / 2 - r) * 32)))], i * 4);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe("toArtWebp", () => {
  it("keeps every alpha byte and the size, and is deterministic", async () => {
    const png = await paintPng(160, 120);
    const { webp, mode } = await toArtWebp(png, "head.png");
    expect(mode).toBe("lossy");
    const [a, b] = await Promise.all([rgba(png), rgba(webp)]);
    expect([b.width, b.height]).toEqual([160, 120]);
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) throw new Error(`alpha differs at ${i}`);
    expect(a.data.equals(b.data)).toBe(false);
    expect((await toArtWebp(png, "head.png")).webp.equals(webp)).toBe(true);
  });

  it("stores a region map lossless, bit-exact", async () => {
    const png = await paintPng(64, 48);
    const { webp, mode } = await toArtWebp(png, "head.regions.png");
    expect(mode).toBe("lossless");
    expect((await rgba(webp)).data.equals((await rgba(png)).data)).toBe(true);
  });
});

describe("deploy and mouth helpers", () => {
  it("leaves out a WAV and a PNG with a WebP beside it, nothing else", () => {
    const has = (path) => path === "a/head.webp";
    expect(servedElsewhere("a/b00.wav", has)).toBe(true);
    expect(servedElsewhere("a/head.png", has)).toBe(true);
    expect(servedElsewhere("a/jaw.png", has)).toBe(false);
    expect(servedElsewhere("a/head.webp", has)).toBe(false);
  });

  it("takes the mouth from the lips, else the rest mouth, else the jaw", () => {
    const jaw = { kind: "jaw", bbox: [10, 20, 30, 40] };
    expect(mouthBox({ mouth: { cx: 50, lineY: 60, width: 20, lips: { left: 40, right: 60, upper: 55, lower: 70 } }, layers: [jaw] }, 0)).toEqual([40, 55, 60, 70]);
    expect(mouthBox({ mouth: { cx: 50, lineY: 60, width: 20 }, layers: [jaw] }, 0)).toEqual([40, 55, 60, 65]);
    expect(mouthBox({ layers: [jaw] }, 0)).toEqual([10, 20, 40, 60]);
  });
});

describe("committed cast art", () => {
  const slugs = artSlugs();

  it("covers every recorded job but Malakor's", () => {
    expect(slugs).toHaveLength(13);
    expect(slugs).not.toContain("malakor");
    expect([...KEEP_PNG]).toEqual(["malakor"]);
  });

  it.each(slugs)("%s passes its geometry check on the WebP (alpha equal, colour within tolerance at mouth, sockets, seams)", async (slug) => {
    const result = await checkJob(`${FORGE_DIR}/${slug}`);
    expect(result.faults).toEqual([]);
    for (const zone of ZONES) {
      expect(result.zones[zone].p99, zone).toBeLessThanOrEqual(TOLERANCE.p99);
      expect(result.zones[zone].max, zone).toBeLessThanOrEqual(TOLERANCE.max);
    }
    expect(result.zones.mouth.pixels + result.zones.seams.pixels).toBeGreaterThan(0);
    expect(result.webpBytes).toBeLessThan(result.pngBytes / 2);
  });

  it("never re-encodes Malakor's house art: his job has no WebP beside a PNG, his portrait is the house bytes", () => {
    const files = readdirSync(`${FORGE_DIR}/malakor`);
    for (const png of files.filter((f) => f.endsWith(".png"))) expect(files, png).not.toContain(png.replace(/\.png$/, ".webp"));
    const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(sha(`${FORGE_DIR}/malakor/portrait.png`)).toBe(sha(new URL("../assets/characters/malakor/rig/portrait.png", import.meta.url)));
  });
});
