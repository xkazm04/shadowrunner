// Test-only helpers (not exported from the package): the committed Malakor portrait, decoded
// without Node's fs, and recorded part fixtures parsed through parseParts.
import portraitUrl from "../../../assets/characters/malakor/rig/portrait.png?inline";
import { decodeImage } from "./image.js";
import { parseParts } from "./parts.js";
import type { Part, Rgba } from "./types.js";

function unbase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) table[alphabet.charCodeAt(i)] = i;
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = ((acc << 6) | (table[clean.charCodeAt(i)] ?? 0)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/** assets/characters/malakor/rig/portrait.png as RGBA (1024 x 1024). */
export function malakorPortrait(): Rgba {
  const decoded = decodeImage(unbase64(portraitUrl.slice(portraitUrl.indexOf(",") + 1)));
  if (!decoded.ok) throw new Error(decoded.errors.message);
  return decoded.value;
}

/** An `?inline` image import (a base64 data: URL) as RGBA; throws when it does not decode. */
export function inlineImage(dataUrl: string): Rgba {
  const decoded = decodeImage(unbase64(dataUrl.slice(dataUrl.indexOf(",") + 1)));
  if (!decoded.ok) throw new Error(decoded.errors.message);
  return decoded.value;
}

/** A recorded parts fixture, through parseParts; throws when it does not parse. */
export function partsOf(json: unknown): Part[] {
  const parsed = parseParts(json);
  if (!parsed.ok) throw new Error("fixture does not parse");
  return parsed.value.parts;
}
