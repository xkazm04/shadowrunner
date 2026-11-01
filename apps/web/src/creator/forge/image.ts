// The upload path of the forge form (creator requirement 3.1, task 5.1): one PNG, JPEG or WebP of
// at most 5 MB, downscaled in the browser so its longer side is at most 1024 px, then sent as
// base64 in `{ mode: "image", imageBase64 }`.
//
// Decisions the spec leaves open:
// - The re-encoded image is always JPEG (quality 0.9): the forge decodes PNG and JPEG only
//   (packages/forge image.ts), so a WebP must be re-encoded anyway, and a 1024 px JPEG keeps the
//   request well under the function body limit. An image already within 1024 px is re-encoded too,
//   which also drops its metadata (location, camera) before it leaves the computer.
// - The browser-only steps (decode, draw, encode) are injected, so the rules are testable here.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SIDE = 1024;
export const ACCEPTED_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
export const JPEG_QUALITY = 0.9;

export type ImageCheck = { ok: true } | { ok: false; message: string };

/** Type and size rules, before anything is decoded. */
export function checkImageFile(file: { type: string; size: number }): ImageCheck {
  if (!ACCEPTED_TYPES.includes(file.type)) return { ok: false, message: "Bring a PNG, JPEG or WebP picture." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "That picture is over 5 MB. Bring a smaller one." };
  if (file.size === 0) return { ok: false, message: "That picture is empty." };
  return { ok: true };
}

/** The size that fits `width` x `height` within `max` on its longer side, keeping the aspect (never upscales). */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface DecodedImage {
  width: number;
  height: number;
}

export interface ImageCodec<T extends DecodedImage> {
  decode(file: Blob): Promise<T>;
  /** Draws `image` at `width` x `height` and returns it as a JPEG Blob. */
  encode(image: T, width: number, height: number, quality: number): Promise<Blob>;
}

export type PreparedImage = { ok: true; base64: string; width: number; height: number; bytes: number } | { ok: false; message: string };

/** Bytes -> base64 without the data: prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Checks, decodes, downscales and encodes one picture for the forge. */
export async function prepareImage<T extends DecodedImage>(file: Blob, codec: ImageCodec<T>): Promise<PreparedImage> {
  const check = checkImageFile(file);
  if (!check.ok) return check;
  let image: T;
  try {
    image = await codec.decode(file);
  } catch {
    return { ok: false, message: "That file could not be read as a picture." };
  }
  const size = fitWithin(image.width, image.height);
  const jpeg = await codec.encode(image, size.width, size.height, JPEG_QUALITY);
  return { ok: true, base64: await blobToBase64(jpeg), ...size, bytes: jpeg.size };
}

/** The browser's codec: createImageBitmap, a canvas, toBlob("image/jpeg"). */
export const browserCodec: ImageCodec<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
  encode: (image, width, height, quality) =>
    new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        reject(new Error("no 2D canvas"));
        return;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, width, height);
      image.close();
      canvas.toBlob((blob) => (blob === null ? reject(new Error("encode failed")) : resolve(blob)), "image/jpeg", quality);
    }),
};
