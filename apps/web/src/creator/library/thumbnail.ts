// A small still of a character for the library strip: its layers composited by z into a square
// canvas (the face as rigged, default look). Cached per record; undefined where the browser cannot
// decode or draw (tests, very old browsers), and the strip shows the initial instead.
import type { Rig } from "@sr/rig";

const cache = new Map<string, Promise<string | undefined>>();

async function compose(rig: Rig, blobs: Readonly<Record<string, Blob>>, size: number): Promise<string | undefined> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return undefined;
  const scale = size / Math.max(rig.width, rig.height);
  const layers = [...rig.layers].filter((l) => l.visible !== false).sort((a, b) => a.z - b.z);
  const images = await Promise.all(
    layers.map((l) => {
      const blob = blobs[l.file];
      return blob === undefined ? undefined : createImageBitmap(blob);
    }),
  );
  layers.forEach((layer, i) => {
    const image = images[i];
    if (image === undefined) return;
    const [x, y, w, h] = layer.bbox;
    ctx.drawImage(image, x * scale, y * scale, w * scale, h * scale);
    image.close();
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  return blob === null ? undefined : URL.createObjectURL(blob);
}

/** An object URL of the record's still, made once per key (e.g. `${id}@${createdAt}`). */
export function thumbnailOf(key: string, rig: Rig, blobs: Readonly<Record<string, Blob>>, size = 160): Promise<string | undefined> {
  let made = cache.get(key);
  if (made === undefined) {
    made = compose(rig, blobs, size).catch(() => undefined);
    cache.set(key, made);
  }
  return made;
}
