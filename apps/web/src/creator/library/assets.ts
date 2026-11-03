// Layer images between the wire, the library and the renderer (creator design.md, task 3.1):
// data: URL <-> Blob, any URL -> Blob, Blob -> ImageBitmap (premultiplied, as the renderer wants).
import type { RigAssets } from "@sr/avatar";
import type { Rig } from "@sr/rig";

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s;

/** A `data:` URL as a Blob (base64 or percent-encoded), or undefined when it is not one. */
export function dataUrlToBlob(url: string): Blob | undefined {
  const m = DATA_URL.exec(url);
  if (m === null) return undefined;
  const type = m[1] === undefined || m[1] === "" ? "text/plain" : m[1];
  const payload = m[4] ?? "";
  try {
    if (m[3] !== undefined) {
      const text = atob(payload);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(payload)], { type });
  } catch {
    return undefined;
  }
}

/** A Blob as a base64 `data:` URL. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(text)}`;
}

export type BlobFetcher = (url: string) => Promise<Response>;

/** Any asset URL (data:, a bundled file, an https Blob URL) as a Blob. Throws when it cannot be read. */
export async function urlToBlob(url: string, fetcher: BlobFetcher = (u) => fetch(u)): Promise<Blob> {
  if (url.startsWith("data:")) {
    const blob = dataUrlToBlob(url);
    if (blob === undefined) throw new Error("unreadable data: URL");
    return blob;
  }
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`asset answered ${res.status}`);
  return res.blob();
}

/** Every URL of `urls` as a Blob, keyed as given. */
export async function urlsToBlobs(urls: Readonly<Record<string, string>>, fetcher?: BlobFetcher): Promise<Record<string, Blob>> {
  const entries = await Promise.all(Object.entries(urls).map(async ([file, url]) => [file, await urlToBlob(url, fetcher)] as const));
  return Object.fromEntries(entries);
}

/** One layer image for the renderer. ImageBitmap where the browser has it, else a decoded <img>. */
export async function blobToImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The files a rig names besides its layer images (character-control): each layer's region map and
 * expression patches. Optional: a character without one draws its base art there.
 */
export function extraFiles(rig: Rig): string[] {
  const files = rig.layers.flatMap((layer) => [
    ...(layer.regions === undefined ? [] : [layer.regions.map]),
    ...Object.values(layer.variants ?? {}).map((patch) => patch.file),
  ]);
  return [...new Set(files)];
}

/**
 * Every image file a rig names, de-duplicated: its layer images, then each layer's region map and
 * expression patches (character-control). Every loader resolves and keeps these the same way; only
 * the layer images are required.
 */
export function rigFiles(rig: Rig): string[] {
  return [...new Set([...rig.layers.map((l) => l.file), ...extraFiles(rig)])];
}

/**
 * The renderer's assets for `rig` from the library's Blobs. Throws when a layer's Blob is missing;
 * region maps and patches are decoded when present, and one that will not decode is left out.
 */
export async function rigAssetsOf(rig: Rig, blobs: Readonly<Record<string, Blob>>): Promise<RigAssets> {
  const assets: RigAssets = {};
  await Promise.all(
    rig.layers.map(async (layer) => {
      const blob = blobs[layer.file];
      if (blob === undefined) throw new Error(`missing ${layer.file}`);
      assets[layer.file] = await blobToImage(blob);
    }),
  );
  await Promise.all(
    extraFiles(rig).map(async (file) => {
      const blob = blobs[file];
      if (blob === undefined || assets[file] !== undefined) return;
      try {
        assets[file] = await blobToImage(blob);
      } catch {
        // The base art stands in for a map or face that does not decode.
      }
    }),
  );
  return assets;
}
