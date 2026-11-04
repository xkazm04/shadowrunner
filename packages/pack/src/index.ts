// @sr/pack: write and read .srpack avatar packs (React-free; depends on @sr/rig and fflate only).
// Task 0 stubs: final signatures, bodies land in task 1.
import type { AvatarPack, PackInput, PackManifest, PackResult } from "./types.js";

export * from "./types.js";

export const PACKAGE = "@sr/pack";

const todo = (name: string): Error => new Error(`@sr/pack: ${name} is not implemented yet (avatar-pack task 1)`);

/** The pack's bytes: a zip with stored entries. Throws when a layer image is missing (a caller bug). */
export function writePack(input: PackInput): Promise<Uint8Array> {
  void input;
  return Promise.reject(todo("writePack"));
}

/** A checked pack, or the first reason it is not one. */
export function readPack(source: Uint8Array | ArrayBuffer | Blob): Promise<PackResult> {
  void source;
  return Promise.reject(todo("readPack"));
}

/** `readPack` of a Blob, or of the bytes fetched from a URL (`fetch_failed` on a non-2xx or network error). */
export function loadPack(source: string | URL | Blob, init?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<PackResult> {
  void source;
  void init;
  return Promise.reject(todo("loadPack"));
}

/** Premultiplied ImageBitmaps keyed by file name, ready for @sr/avatar's renderer. */
export function decodePackImages(files: AvatarPack["files"]): Promise<Record<string, ImageBitmap>> {
  void files;
  return Promise.reject(todo("decodePackImages"));
}

/** `<slug of name>.srpack`. */
export function packFileName(name: string): string {
  void name;
  throw todo("packFileName");
}

/** The README.txt written into a pack. */
export function packReadme(manifest: PackManifest): string {
  void manifest;
  throw todo("packReadme");
}
