// The image files a rig names, their MIME types, and the move of inline `data:` images to named
// files (design "Container").
import type { Layer, Rig } from "@sr/rig";

/**
 * Every image file a rig names, de-duplicated, in the order the renderer loads them: layer images,
 * then region maps, then expression patches (as apps/web `rigFiles` and @sr/avatar
 * `rigAssetFiles`). Only the layer images are required.
 */
export function rigFiles(rig: Pick<Rig, "layers">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const once = (file: string | undefined): void => {
    if (file === undefined || seen.has(file)) return;
    seen.add(file);
    out.push(file);
  };
  for (const layer of rig.layers) once(layer.file);
  for (const layer of rig.layers) once(layer.regions?.map);
  for (const layer of rig.layers) for (const patch of Object.values(layer.variants ?? {})) once(patch.file);
  // face-control: eye sockets, closed lids, and each face's socket.
  for (const layer of rig.layers) {
    once(layer.socket);
    once(layer.closed);
    for (const patch of Object.values(layer.variants ?? {})) once(patch.socket);
  }
  return out;
}

const MIME: Readonly<Record<string, string>> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** The MIME type of an image file name, from its extension; `application/octet-stream` otherwise. */
export function mimeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot < 0 ? undefined : MIME[name.slice(dot + 1).toLowerCase()]) ?? "application/octet-stream";
}

const DATA_URL = /^data:image\/(png|webp);base64,(.+)$/s;

/** The bytes and extension of a PNG or WebP base64 `data:` URL, or undefined when `file` is not one. */
export function decodeDataUrl(file: string): { ext: "png" | "webp"; bytes: Uint8Array } | undefined {
  const match = DATA_URL.exec(file);
  if (match === null) return undefined;
  const binary = atob(match[2] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { ext: match[1] === "webp" ? "webp" : "png", bytes };
}

/**
 * The rig with every inline `data:` image moved to a named file: a layer's to `<layer>.<ext>`, a
 * region map's to `<layer>.regions.<ext>`, an expression patch's to `<layer>.<family>.<ext>` (a
 * `-2`, `-3`... suffix when the name is taken). The same data URL gets one name. The moved bytes
 * are returned keyed by their new names.
 */
export function inlineToFiles(rig: Rig): { rig: Rig; moved: Map<string, Uint8Array> } {
  const taken = new Set(rigFiles(rig).filter((file) => !file.startsWith("data:")));
  const named = new Map<string, string>();
  const moved = new Map<string, Uint8Array>();
  const nameFor = (file: string, stem: string): string => {
    const decoded = decodeDataUrl(file);
    if (decoded === undefined) return file;
    const known = named.get(file);
    if (known !== undefined) return known;
    let name = `${stem}.${decoded.ext}`;
    for (let n = 2; taken.has(name); n += 1) name = `${stem}-${n}.${decoded.ext}`;
    taken.add(name);
    named.set(file, name);
    moved.set(name, decoded.bytes);
    return name;
  };
  const layers = rig.layers.map((layer): Layer => {
    const next: Layer = { ...layer, file: nameFor(layer.file, layer.name) };
    if (layer.regions !== undefined) next.regions = { ...layer.regions, map: nameFor(layer.regions.map, `${layer.name}.regions`) };
    if (layer.variants !== undefined) {
      next.variants = Object.fromEntries(
        Object.entries(layer.variants).map(([family, patch]) => [
          family,
          { ...patch, file: nameFor(patch.file, `${layer.name}.${family}`), ...(patch.socket === undefined ? {} : { socket: nameFor(patch.socket, `${layer.name}.${family}.socket`) }) },
        ]),
      );
    }
    if (layer.socket !== undefined) next.socket = nameFor(layer.socket, `${layer.name}.socket`);
    if (layer.closed !== undefined) next.closed = nameFor(layer.closed, `${layer.name}.closed`);
    return next;
  });
  return { rig: { ...rig, layers }, moved };
}
