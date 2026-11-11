// @sr/pack: write and read .srpack avatar packs (React-free; depends on @sr/rig and fflate only).
// Spec .kiro/specs/avatar-pack, design "Container" and "API".
import type { Rig } from "@sr/rig";
import type { AvatarPack } from "./types.js";

export * from "./types.js";
export { writePack, PACK_MTIME } from "./write.js";
export { readPack, loadPack } from "./read.js";
export { packFileName, packReadme, LICENCE_LABELS, PACK_FORMAT_DOC } from "./readme.js";
export { rigFiles, mimeOf } from "./files.js";
export { packErrorSentence } from "./sentences.js";
export { readSheet, SHEET_LIMITS, type CharacterSheet } from "./sheet.js";

export const PACKAGE = "@sr/pack";

/**
 * Premultiplied ImageBitmaps keyed by file name, ready for @sr/avatar's renderer. With the pack's
 * rig, its morph's motion image and sway map (companion-lanes) are decoded as data instead: as stored,
 * no premultiply and no colour-space conversion.
 */
export async function decodePackImages(files: AvatarPack["files"], rig?: Pick<Rig, "morph">): Promise<Record<string, ImageBitmap>> {
  const raw = new Set([rig?.morph?.flow, rig?.morph?.sway?.map]);
  const decoded = await Promise.all(
    Object.entries(files).map(async ([name, blob]) => [name, await createImageBitmap(blob, raw.has(name) ? { premultiplyAlpha: "none", colorSpaceConversion: "none" } : { premultiplyAlpha: "premultiply" })] as const),
  );
  return Object.fromEntries(decoded);
}
