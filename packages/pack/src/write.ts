// writePack (design "Container"): a zip of stored entries - pack.json, rig.json, README.txt, then
// files/<name> sorted - whose bytes depend only on the input.
import { readLook, serializeRig, validateRig } from "@sr/rig";
import { zipSync, type Zippable } from "fflate";
import { inlineToFiles, rigFiles } from "./files.js";
import { packReadme } from "./readme.js";
import { readSheet } from "./sheet.js";
import { PACK_FORMAT, PACK_VERSION, type PackInput, type PackManifest } from "./types.js";

/**
 * The entry time. A zip's DOS timestamp has no time zone and fflate fills it from the Date's local
 * fields, so this is 2026-01-01 00:00:00 local: every machine then writes the same field
 * (2026-01-01 00:00:00), where a UTC instant would shift with the writer's zone.
 */
export const PACK_MTIME = new Date(2026, 0, 1, 0, 0, 0);

const encoder = new TextEncoder();

async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
}

/** The pack's bytes: a zip with stored entries. Throws when a layer image is missing (a caller bug). */
export async function writePack(input: PackInput): Promise<Uint8Array> {
  const { rig, moved } = inlineToFiles(input.rig);
  const checked = validateRig(rig);
  if (!checked.ok) throw new Error(`writePack: the rig does not validate: ${checked.errors[0]?.message ?? "unknown"}`);
  const look = readLook(input.look, rig);
  if (look === undefined) throw new Error("writePack: the look does not read back");

  const layerFiles = new Set(rig.layers.map((layer) => layer.file));
  const images = new Map<string, Uint8Array>();
  for (const name of rigFiles(rig)) {
    const given = moved.get(name) ?? input.files[name];
    if (given === undefined) {
      if (layerFiles.has(name)) throw new Error(`writePack: missing the image ${name}`);
      continue;
    }
    images.set(name, await bytesOf(given));
  }
  const files = [...images.keys()].sort();

  const author = input.author?.trim() ?? "";
  const sheet = input.sheet === undefined ? undefined : readSheet(input.sheet);
  const manifest: PackManifest = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    app: "shadowrunner",
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    id: rig.id,
    name: rig.name,
    look,
    voice: input.voice,
    licence: input.licence,
    ...(author === "" ? {} : { author }),
    source: rig.source,
    ...(rig.fictional === true ? { fictional: true as const } : {}),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(sheet === undefined ? {} : { sheet }),
    files,
  };

  const entries: Zippable = {
    "pack.json": encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    "rig.json": encoder.encode(serializeRig(rig)),
    "README.txt": encoder.encode(packReadme(manifest)),
  };
  for (const name of files) entries[`files/${name}`] = images.get(name) ?? new Uint8Array();
  return zipSync(entries, { level: 0, mtime: PACK_MTIME });
}
