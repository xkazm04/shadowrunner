// forge-pipeline task 2.1 with director ruling 1: decodeImage sniffs PNG/JPEG by magic bytes,
// encodePng is lossless, dataUrl is standard base64. Synthetic images only; no network.
import fc from "fast-check";
import { encode as encodeJpeg } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { MAX_PIXELS, base64, dataUrl, decodeImage, encodePng, sniffImage } from "./image.js";
import type { Rgba } from "./types.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const arbImage: fc.Arbitrary<Rgba> = fc
  .record({ width: fc.integer({ min: 1, max: 9 }), height: fc.integer({ min: 1, max: 9 }) })
  .chain(({ width, height }) =>
    fc
      .uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 })
      .map((bytes) => ({ width, height, data: new Uint8ClampedArray(bytes) })),
  );

function flat(width: number, height: number, rgb: [number, number, number]): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width, height, data };
}

/** Test-local base64 decoder, independent of the encoder under test. */
function unbase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bits = [...text.replace(/=+$/, "")].map((ch) => alphabet.indexOf(ch).toString(2).padStart(6, "0")).join("");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Uint8Array.from(out);
}

describe("sniffImage", () => {
  it("names PNG and JPEG by magic bytes", () => {
    expect(sniffImage(Uint8Array.from([...PNG_MAGIC, 0]))).toBe("png");
    expect(sniffImage(Uint8Array.from([...JPEG_MAGIC, 0xe0]))).toBe("jpeg");
    expect(sniffImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBeUndefined(); // RIFF (WebP)
    expect(sniffImage(new Uint8Array(0))).toBeUndefined();
  });
});

describe("decodeImage", () => {
  it("property: PNG round trip through encodePng is lossless", () => {
    fc.assert(
      fc.property(arbImage, (image) => {
        const result = decodeImage(encodePng(image));
        expect(result).toEqual({ ok: true, value: image });
      }),
      { numRuns: 60 },
    );
  });

  it("decodes a JPEG to RGBA with opaque alpha and close colours", () => {
    const source = flat(32, 24, [200, 90, 30]);
    const jpeg = encodeJpeg({ width: 32, height: 24, data: source.data }, 95).data;
    const result = decodeImage(Uint8Array.from(jpeg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width).toBe(32);
    expect(result.value.height).toBe(24);
    expect(result.value.data).toBeInstanceOf(Uint8ClampedArray);
    expect(result.value.data.length).toBe(32 * 24 * 4);
    for (let i = 0; i < result.value.data.length; i += 4) {
      const px = result.value.data.subarray(i, i + 4);
      expect(Math.abs((px[0] ?? 0) - 200)).toBeLessThanOrEqual(6);
      expect(Math.abs((px[1] ?? 0) - 90)).toBeLessThanOrEqual(6);
      expect(Math.abs((px[2] ?? 0) - 30)).toBeLessThanOrEqual(6);
      expect(px[3]).toBe(255);
    }
  });

  it("property: bytes without a PNG or JPEG signature are unsupported_format", () => {
    const notImage = fc
      .uint8Array({ maxLength: 64 })
      .filter((b) => sniffImage(b) === undefined);
    fc.assert(
      fc.property(notImage, (bytes) => {
        expect(decodeImage(bytes)).toEqual({ ok: false, errors: { code: "unsupported_format", message: expect.any(String) } });
      }),
    );
  });

  it("property: garbage behind a valid signature is an error result, never a throw", () => {
    // PNG garbage gets a plausible IHDR (small size, any depth/colour type) so the decoder runs.
    const pngGarbage = fc
      .tuple(fc.integer({ min: 1, max: 64 }), fc.integer({ min: 1, max: 64 }), fc.uint8Array({ minLength: 5, maxLength: 5 }), fc.uint8Array({ maxLength: 256 }))
      .map(([w, h, ihdrTail, rest]) =>
        Uint8Array.from([...PNG_MAGIC, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, w, 0, 0, 0, h, ...ihdrTail, 0, 0, 0, 0, ...rest]),
      );
    const jpegGarbage = fc.uint8Array({ maxLength: 256 }).map((rest) => Uint8Array.from([...JPEG_MAGIC, ...rest]));
    fc.assert(
      fc.property(jpegGarbage, (bytes) => {
        const result = decodeImage(bytes);
        if (result.ok) {
          expect(result.value.data.length).toBe(result.value.width * result.value.height * 4);
        } else {
          expect(["corrupt", "too_large"]).toContain(result.errors.code);
        }
      }),
      { numRuns: 200 },
    );
    // upng-js turns a broken chunk chain into a blank image; decodeImage must call it corrupt.
    fc.assert(
      fc.property(pngGarbage, (bytes) => {
        expect(decodeImage(bytes)).toEqual({ ok: false, errors: { code: "corrupt", message: expect.any(String) } });
      }),
      { numRuns: 200 },
    );
  });

  it("property: a PNG cut short anywhere is corrupt", () => {
    fc.assert(
      fc.property(arbImage, fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), (image, at) => {
        const png = encodePng(image);
        const cut = png.subarray(0, Math.floor(at * png.length));
        expect(decodeImage(cut).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a PNG whose header declares more than MAX_PIXELS, before decoding", () => {
    const header = Uint8Array.from([
      ...PNG_MAGIC,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, // IHDR, length 13
      0, 0, 0x13, 0x88, 0, 0, 0x13, 0x88, // 5000 x 5000
      8, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(5000 * 5000).toBeGreaterThan(MAX_PIXELS);
    expect(decodeImage(header)).toEqual({ ok: false, errors: { code: "too_large", message: expect.any(String) } });
  });
});

describe("encodePng", () => {
  it("emits PNG bytes", () => {
    expect(sniffImage(encodePng(flat(2, 2, [1, 2, 3])))).toBe("png");
  });

  it("rejects data whose length does not match the size", () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(15) })).toThrow(RangeError);
    expect(() => encodePng({ width: 0, height: 2, data: new Uint8ClampedArray(0) })).toThrow(RangeError);
  });
});

describe("base64 and dataUrl", () => {
  it("matches the RFC 4648 test vectors", () => {
    const enc = (s: string) => base64(Uint8Array.from([...s].map((c) => c.charCodeAt(0))));
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map(enc)).toEqual([
      "",
      "Zg==",
      "Zm8=",
      "Zm9v",
      "Zm9vYg==",
      "Zm9vYmE=",
      "Zm9vYmFy",
    ]);
  });

  it("property: base64 decodes back to the input", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const text = base64(bytes);
        expect(text.length).toBe(Math.ceil(bytes.length / 3) * 4);
        expect(unbase64(text)).toEqual(bytes);
      }),
    );
  });

  it("dataUrl defaults to PNG", () => {
    expect(dataUrl(Uint8Array.from([0x89, 0x50, 0x4e]))).toBe("data:image/png;base64,iVBO");
    expect(dataUrl(Uint8Array.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBe("data:image/jpeg;base64,/9j/");
  });
});
