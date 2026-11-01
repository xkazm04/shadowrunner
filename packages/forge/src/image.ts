// Image codecs for the forge (director ruling 1 on docs/decisions/0003, 2026-11-01).
// Gemini returns JPEG portraits, so decoding sniffs the magic bytes and takes PNG (upng-js) or
// JPEG (jpeg-js); both are pure JS. Layers are always encoded as PNG. Pure: bytes in, bytes out.
import { decode as decodeJpegBytes } from "jpeg-js";
import UPNG from "upng-js";
import type { Result } from "@sr/rig";
import type { Rgba } from "./types.js";

export type ImageFormat = "png" | "jpeg";

export interface ImageError {
  code: "unsupported_format" | "corrupt" | "too_large";
  message: string;
}

/** Decoding refuses images above this many pixels (4096 x 4096; portraits are 1024 x 1024). */
export const MAX_PIXELS = 4096 * 4096;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/** The format named by the leading magic bytes, or undefined when neither PNG nor JPEG. */
export function sniffImage(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpeg";
  return undefined;
}

const fail = (code: ImageError["code"], message: string): Result<Rgba, ImageError> => ({
  ok: false,
  errors: { code, message },
});

/** Big-endian u32 at `at`; the caller has checked the length. */
const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) * 0x1000000 + (bytes[at + 1] ?? 0) * 0x10000 + (bytes[at + 2] ?? 0) * 0x100 + (bytes[at + 3] ?? 0);

const chunkType = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

/**
 * Why the PNG chunk chain is broken, or undefined when it is whole: IHDR first, every chunk
 * inside the buffer, at least one IDAT, ending at IEND. upng-js decodes a broken chain to a
 * blank image without complaint, so this walk is what turns truncation into `corrupt`.
 */
function pngChainProblem(bytes: Uint8Array): string | undefined {
  if (chunkType(bytes, 12) !== "IHDR" || u32(bytes, 8) !== 13) return "PNG does not start with IHDR";
  let at = 8;
  let sawData = false;
  while (at + 12 <= bytes.length) {
    const end = at + 12 + u32(bytes, at); // length (4) + type (4) + data + CRC (4)
    if (end > bytes.length) return "PNG chunk runs past the end of the file";
    const type = chunkType(bytes, at + 4);
    if (type === "IDAT") sawData = true;
    if (type === "IEND") return sawData ? undefined : "PNG has no image data (IDAT)";
    at = end;
  }
  return "PNG is truncated (no IEND)";
}

function decodePng(bytes: Uint8Array): Result<Rgba, ImageError> {
  // IHDR is the first chunk: length (4) + "IHDR" (4) + width (4) + height (4) after the signature.
  if (bytes.length < 33) return fail("corrupt", "PNG is shorter than its header");
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  if (width === 0 || height === 0) return fail("corrupt", "PNG has a zero dimension");
  if (width * height > MAX_PIXELS) return fail("too_large", `PNG is ${width}x${height}, over ${MAX_PIXELS} pixels`);
  const chain = pngChainProblem(bytes);
  if (chain !== undefined) return fail("corrupt", chain);
  try {
    const png = UPNG.decode(bytes.slice().buffer);
    const frame = UPNG.toRGBA8(png)[0];
    const expected = png.width * png.height * 4;
    if (frame === undefined || frame.byteLength < expected) return fail("corrupt", "PNG pixel data is incomplete");
    return {
      ok: true,
      value: { width: png.width, height: png.height, data: new Uint8ClampedArray(frame.slice(0, expected)) },
    };
  } catch {
    return fail("corrupt", "PNG could not be decoded");
  }
}

function decodeJpeg(bytes: Uint8Array): Result<Rgba, ImageError> {
  try {
    const jpeg = decodeJpegBytes(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: MAX_PIXELS / 1e6,
      maxMemoryUsageInMB: 512,
    });
    const expected = jpeg.width * jpeg.height * 4;
    if (jpeg.width === 0 || jpeg.height === 0 || jpeg.data.length < expected) {
      return fail("corrupt", "JPEG pixel data is incomplete");
    }
    return {
      ok: true,
      value: { width: jpeg.width, height: jpeg.height, data: new Uint8ClampedArray(jpeg.data.subarray(0, expected)) },
    };
  } catch (error) {
    const limit = error instanceof Error && /limit/i.test(error.message);
    return limit ? fail("too_large", `JPEG is over ${MAX_PIXELS} pixels`) : fail("corrupt", "JPEG could not be decoded");
  }
}

/** PNG or JPEG bytes -> RGBA (8 bits per channel). Never throws; messages carry no image bytes. */
export function decodeImage(bytes: Uint8Array): Result<Rgba, ImageError> {
  const format = sniffImage(bytes);
  if (format === "png") return decodePng(bytes);
  if (format === "jpeg") return decodeJpeg(bytes);
  return fail("unsupported_format", "not a PNG or JPEG (magic bytes)");
}

/**
 * `UPNG.encode` with its sixth parameter, `forbidPlte`, which @types/upng-js omits. upng-js 2.1.0
 * picks an indexed (palette) PNG for images with <= 256 colours, and its own decoder cannot read
 * some of those back, so layers are always written as truecolour (RGB or RGBA, 8 bit).
 */
const encodeTruecolor: (
  imgs: ArrayBuffer[],
  w: number,
  h: number,
  cnum: number,
  dels: number[] | undefined,
  forbidPlte: boolean,
) => ArrayBuffer = UPNG.encode;

/** RGBA -> lossless PNG bytes (truecolour, 8 bit, never indexed). */
export function encodePng(image: Rgba): Uint8Array {
  const expected = image.width * image.height * 4;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new RangeError(`encodePng: bad size ${image.width}x${image.height}`);
  }
  if (image.data.length !== expected) {
    throw new RangeError(`encodePng: data has ${image.data.length} bytes, expected ${expected}`);
  }
  return new Uint8Array(encodeTruecolor([image.data.slice().buffer], image.width, image.height, 0, undefined, true));
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with padding (no Buffer or btoa, so the module stays runtime-neutral). */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63);
    out += i + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : "=";
    out += i + 2 < bytes.length ? BASE64.charAt(n & 63) : "=";
  }
  return out;
}

/** Bytes -> `data:` URL. Layer files are PNG (the only data: URLs a Rig accepts). */
export function dataUrl(bytes: Uint8Array, mime: "image/png" | "image/jpeg" = "image/png"): string {
  return `data:${mime};base64,${base64(bytes)}`;
}
