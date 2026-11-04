// readPack and loadPack (design "API"): every check in the documented order, the first failure
// returned as a typed error. Entries the rig does not reference are ignored.
import { parseRigJson, readLook, type Rig } from "@sr/rig";
import { unzipSync, type Unzipped } from "fflate";
import { mimeOf, rigFiles } from "./files.js";
import { PACK_FORMAT, PACK_LICENCES, PACK_MAX_BYTES, PACK_VERSION, type PackErrorCode, type PackLicence, type PackManifest, type PackResult } from "./types.js";

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const SOURCES: readonly string[] = ["forge", "replay", "import"] satisfies readonly Rig["source"][];
const LICENCES: readonly string[] = PACK_LICENCES;

const fail = (code: PackErrorCode, detail: string): PackResult => ({ ok: false, error: { code, detail } });
const decoder = new TextDecoder();

/** The manifest's own fields (look aside, checked against the rig later), or why they are off. */
function checkManifest(value: Fields): Omit<PackManifest, "look"> | string {
  const { app, exportedAt, id, name, voice, licence, author, source, fictional, createdAt, files } = value;
  if (app !== "shadowrunner") return "app must be \"shadowrunner\"";
  for (const [key, v] of Object.entries({ exportedAt, id, name, voice })) if (!isText(v)) return `${key} must be a non-empty string`;
  if (typeof licence !== "string" || !LICENCES.includes(licence)) return `licence must be one of ${PACK_LICENCES.join(", ")}`;
  if (typeof source !== "string" || !SOURCES.includes(source)) return "source must be forge, replay or import";
  if (author !== undefined && !isText(author)) return "author must be a non-empty string when present";
  if (createdAt !== undefined && !isText(createdAt)) return "createdAt must be a non-empty string when present";
  if (fictional !== undefined && fictional !== true) return "fictional must be true when present";
  if (!Array.isArray(files) || !files.every((f) => typeof f === "string")) return "files must be an array of strings";
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    app,
    exportedAt: exportedAt as string,
    id: id as string,
    name: name as string,
    voice: voice as string,
    licence: licence as PackLicence,
    ...(author === undefined ? {} : { author }),
    source: source as Rig["source"],
    ...(fictional === true ? { fictional } : {}),
    ...(createdAt === undefined ? {} : { createdAt }),
    files: [...(files as string[])],
  };
}

/** The pack's entries, `too_large` when they unpack past the limit, undefined when it is no zip. */
function unzip(bytes: Uint8Array): Unzipped | "too_large" | undefined {
  let unpacked = 0;
  try {
    const entries = unzipSync(bytes, {
      filter: (file) => {
        const wanted = file.name === "pack.json" || file.name === "rig.json" || file.name.startsWith("files/");
        if (wanted) unpacked += file.originalSize;
        return wanted && unpacked <= PACK_MAX_BYTES;
      },
    });
    return unpacked > PACK_MAX_BYTES ? "too_large" : entries;
  } catch {
    return undefined;
  }
}

function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

/** A checked pack, or the first reason it is not one. */
export async function readPack(source: Uint8Array | ArrayBuffer | Blob): Promise<PackResult> {
  const size = source instanceof Blob ? source.size : source.byteLength;
  if (size > PACK_MAX_BYTES) return fail("too_large", `${size} bytes is over the ${PACK_MAX_BYTES} byte limit`);
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source);

  const entries = unzip(bytes);
  if (entries === "too_large") return fail("too_large", `unpacks to more than ${PACK_MAX_BYTES} bytes`);
  if (entries === undefined) return fail("not_a_pack", "not a zip file");
  const packJson = entries["pack.json"];
  if (packJson === undefined) return fail("not_a_pack", "no pack.json");
  const raw = json(packJson);
  if (!isRecord(raw) || raw.format !== PACK_FORMAT) return fail("not_a_pack", "pack.json is not an srpack manifest");
  if (typeof raw.version === "number" && raw.version > PACK_VERSION) return fail("newer_version", `format version ${raw.version}; this reader knows ${PACK_VERSION}`);
  if (raw.version !== PACK_VERSION) return fail("bad_manifest", `version must be ${PACK_VERSION}`);
  const fields = checkManifest(raw);
  if (typeof fields === "string") return fail("bad_manifest", fields);

  const rigJson = entries["rig.json"];
  if (rigJson === undefined) return fail("bad_rig", "no rig.json");
  const parsed = parseRigJson(decoder.decode(rigJson));
  if (!parsed.ok) {
    const first = parsed.errors[0];
    return fail("bad_rig", first === undefined ? "the rig does not validate" : `${first.path ?? "$"}: ${first.message}`);
  }
  const rig = parsed.value;
  if (fields.id !== rig.id) return fail("bad_manifest", `id ${fields.id} does not match the rig's ${rig.id}`);
  const look = readLook(raw.look, rig);
  if (look === undefined) return fail("bad_look", "the saved look does not read");

  for (const layer of rig.layers) if (entries[`files/${layer.file}`] === undefined) return fail("missing_file", layer.file);
  const files: Record<string, Blob> = {};
  for (const name of rigFiles(rig)) {
    const data = entries[`files/${name}`];
    if (data !== undefined) files[name] = new Blob([data], { type: mimeOf(name) });
  }
  return { ok: true, pack: { manifest: { ...fields, look }, rig, look, voice: fields.voice, files } };
}

/** `readPack` of a Blob, or of the bytes fetched from a URL (`fetch_failed` on a non-2xx or network error). */
export async function loadPack(source: string | URL | Blob, init?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<PackResult> {
  if (source instanceof Blob) return readPack(source);
  const get: typeof fetch = init?.fetch ?? ((input, options) => globalThis.fetch(input, options));
  const url = String(source);
  let bytes: ArrayBuffer;
  try {
    const response = await get(url, init?.signal === undefined ? undefined : { signal: init.signal });
    if (!response.ok) return fail("fetch_failed", `${url}: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  } catch (error) {
    return fail("fetch_failed", `${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readPack(bytes);
}
