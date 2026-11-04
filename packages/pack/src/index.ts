// @sr/pack: write and read .srpack avatar packs (React-free; depends on @sr/rig and fflate only).
// Spec .kiro/specs/avatar-pack, design "Container" and "API".
import type { AvatarPack } from "./types.js";

export * from "./types.js";
export { writePack, PACK_MTIME } from "./write.js";
export { readPack, loadPack } from "./read.js";
export { packFileName, packReadme, LICENCE_LABELS, PACK_FORMAT_DOC } from "./readme.js";
export { rigFiles, mimeOf } from "./files.js";
export { packErrorSentence } from "./sentences.js";

export const PACKAGE = "@sr/pack";

/** Premultiplied ImageBitmaps keyed by file name, ready for @sr/avatar's renderer. */
export async function decodePackImages(files: AvatarPack["files"]): Promise<Record<string, ImageBitmap>> {
  const decoded = await Promise.all(
    Object.entries(files).map(async ([name, blob]) => [name, await createImageBitmap(blob, { premultiplyAlpha: "premultiply" })] as const),
  );
  return Object.fromEntries(decoded);
}
