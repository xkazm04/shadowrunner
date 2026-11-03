// The pixels behind a glass pick (pick.ts): a record's image Blobs decoded to RGBA arrays, lazily
// (on the first click) and once per file. A browser without createImageBitmap or a 2D canvas
// answers undefined, and the pick then finds nothing rather than guessing.
import type { Pixels } from "./pick";

/** Reads one image Blob (a layer image, a region map) as straight-alpha RGBA. */
export type PixelReader = (file: string, blob: Blob) => Promise<Pixels | undefined>;

type Ctx = Pick<CanvasRenderingContext2D, "drawImage" | "getImageData">;

function context(width: number, height: number): Ctx | undefined {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height).getContext("2d") ?? undefined;
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d") ?? undefined;
}

/** The default reader: the Blob decoded without premultiplying or colour conversion, so a map's R is exact. */
export const decodePixels: PixelReader = async (_file, blob) => {
  if (typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const ctx = context(bitmap.width, bitmap.height);
    if (ctx === undefined) return undefined;
    ctx.drawImage(bitmap, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return { width, height, data };
  } catch {
    return undefined;
  }
};
