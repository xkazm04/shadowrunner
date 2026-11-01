import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blobToBase64, checkImageFile, fitWithin, MAX_SIDE, MAX_UPLOAD_BYTES, prepareImage, type DecodedImage, type ImageCodec } from "./image";

function fakeCodec(width: number, height: number): ImageCodec<DecodedImage> & { drawn: [number, number][] } {
  const drawn: [number, number][] = [];
  return {
    drawn,
    decode: async () => ({ width, height }),
    encode: async (_image, w, h) => {
      drawn.push([w, h]);
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    },
  };
}

const file = (type: string, size: number): Blob => new Blob([new Uint8Array(size)], { type });

describe("checkImageFile", () => {
  it("accepts PNG, JPEG and WebP up to 5 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(checkImageFile({ type, size: MAX_UPLOAD_BYTES }).ok).toBe(true);
  });

  it("rejects anything over 5 MB and any other type", () => {
    expect(checkImageFile({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 }).ok).toBe(false);
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/plain", ""]) expect(checkImageFile({ type, size: 10 }).ok).toBe(false);
  });
});

describe("fitWithin (properties)", () => {
  const side = fc.integer({ min: 1, max: 12_000 });

  it("never exceeds 1024 px on either side and never upscales", () => {
    fc.assert(
      fc.property(side, side, (w, h) => {
        const out = fitWithin(w, h);
        return out.width <= MAX_SIDE && out.height <= MAX_SIDE && out.width <= w && out.height <= h && out.width >= 1 && out.height >= 1;
      }),
    );
  });

  it("keeps the aspect ratio (each side within half a pixel of the exact scale), and a small picture as it is", () => {
    fc.assert(
      fc.property(side, side, (w, h) => {
        const out = fitWithin(w, h);
        if (Math.max(w, h) <= MAX_SIDE) return out.width === w && out.height === h;
        const s = MAX_SIDE / Math.max(w, h);
        const near = (got: number, exact: number) => Math.abs(got - exact) <= 0.5 || (got === 1 && exact < 1);
        return near(out.width, w * s) && near(out.height, h * s);
      }),
    );
  });
});

describe("prepareImage", () => {
  it("downscales a large picture to 1024 on its longer side and returns JPEG base64", async () => {
    const codec = fakeCodec(4000, 3000);
    const out = await prepareImage(file("image/png", 2000), codec);
    expect(codec.drawn).toEqual([[1024, 768]]);
    expect(out).toMatchObject({ ok: true, width: 1024, height: 768, base64: "/9j/" });
  });

  it("rejects before decoding when the file is too large or not an image", async () => {
    const codec = fakeCodec(10, 10);
    expect((await prepareImage(file("image/jpeg", MAX_UPLOAD_BYTES + 1), codec)).ok).toBe(false);
    expect((await prepareImage(file("image/gif", 10), codec)).ok).toBe(false);
    expect(codec.drawn).toEqual([]);
  });

  it("reports a file that does not decode", async () => {
    const codec: ImageCodec<DecodedImage> = { decode: async () => Promise.reject(new Error("bad")), encode: async () => new Blob() };
    expect(await prepareImage(file("image/png", 10), codec)).toMatchObject({ ok: false });
  });

  it("blobToBase64 encodes bytes", async () => {
    expect(await blobToBase64(new Blob([new Uint8Array([1, 2, 3])]))).toBe("AQID");
  });
});
