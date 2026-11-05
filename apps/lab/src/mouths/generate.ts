// L2's mouth-set generator (Node): from a character's pack, the rest crop of its face around the
// mouth (mouthGeometry, the page's own), then one image per mouth shape - edited by the image
// model from that crop, or drawn as a deterministic placeholder - into
// var/lab/mouths/<character>/ with manifest.json and cost.json. `rest` is the crop itself (no call).
// A shape the model fails is left out of the manifest (L2 draws L1's mouth for it) and named in
// `failed`; the run fails only when every shape fails.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPack } from "@sr/pack";
import type { Layer, Rig } from "@sr/rig";
import { mouthGeometry, type MouthGeometry } from "../page/lip/mouth/geometry.js";
import { MOUTH_SHAPES, SHAPE_PARAMS, type MouthShape } from "../page/lip/mouth/shapes.js";
import type { MouthSetManifest } from "../page/lip/mouth/manifest.js";
import type { ImageEditor } from "./gemini.js";
import type { CropMouth, ImageOps, PlacedLayer } from "./images.js";
import { shapePrompt } from "./prompts.js";

/** The image model sees the crop at this size (it answers 1:1 1K). */
export const MODEL_INPUT_PX = 1024;

export interface GenerateInput {
  character: string;
  packBytes: Uint8Array;
  outDir: string;
  images: ImageOps;
  /** Absent: a placeholder set (no model call). */
  editor?: ImageEditor;
  /** Only these shapes (default all). */
  only?: readonly MouthShape[];
  now?: () => Date;
  log: (line: string) => void;
}

export interface CostRecord {
  character: string;
  source: "gemini" | "placeholder";
  model?: string;
  calls: number;
  usdPerCall?: number;
  usd: number;
  at: string;
}

export interface GenerateResult {
  manifest: MouthSetManifest & { failed?: Partial<Record<MouthShape, string>> };
  cost: CostRecord;
}

/** The jaw, the head it follows, and every visible layer on the head's chain, back to front. */
export function faceLayers(rig: Rig): { jaw: Layer; head?: Layer; chain: Layer[] } {
  const jaw = rig.layers.find((l) => l.kind === "jaw");
  if (jaw === undefined) throw new Error(`The rig "${rig.id}" has no jaw layer, so it has no mouth for L2 to dress.`);
  const byName = new Map(rig.layers.map((l) => [l.name, l]));
  const head = (jaw.follow === undefined ? undefined : byName.get(jaw.follow)) ?? rig.layers.find((l) => l.kind === "head");
  const onChain = (l: Layer): boolean => {
    for (let at: Layer | undefined = l, hops = 0; at !== undefined && hops < 32; at = at.follow === undefined ? undefined : byName.get(at.follow), hops += 1) {
      if (at === head || at === jaw) return true;
    }
    return false;
  };
  const chain = rig.layers.filter((l) => l.visible !== false && l.kind !== "static" && onChain(l)).sort((a, b) => a.z - b.z);
  return { jaw, ...(head === undefined ? {} : { head }), chain };
}

const intersects = (a: Layer["bbox"], [x, y, s]: MouthGeometry["crop"]): boolean => a[0] < x + s && a[0] + a[2] > x && a[1] < y + s && a[1] + a[3] > y;

/** The mouth inside the crop, px. */
export function cropMouth(g: MouthGeometry): CropMouth {
  return { cx: g.cx - g.crop[0], cy: g.lineY - g.crop[1], width: g.width, maxOpen: g.maxOpen };
}

export async function generateMouthSet(input: GenerateInput): Promise<GenerateResult> {
  const { character, outDir, images, editor, log } = input;
  const read = await readPack(input.packBytes);
  if (!read.ok) throw new Error(`The pack for "${character}" is unreadable (${read.error.code}: ${read.error.detail}).`);
  const { rig } = read.pack;
  const { jaw, head, chain } = faceLayers(rig);
  const geometry = mouthGeometry(jaw, head);
  const { crop } = geometry;

  await rm(outDir, { recursive: true, force: true });
  const work = join(outDir, ".work");
  await mkdir(work, { recursive: true });
  const placed: PlacedLayer[] = [];
  for (const layer of chain.filter((l) => intersects(l.bbox, crop))) {
    const blob = read.pack.files[layer.file];
    if (blob === undefined) continue;
    const path = join(work, layer.file.replace(/[^A-Za-z0-9._-]/g, "_"));
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    placed.push({ path, x: layer.bbox[0] - crop[0], y: layer.bbox[1] - crop[1], w: layer.bbox[2], h: layer.bbox[3] });
  }
  const restPath = join(outDir, "rest.png");
  await images.composeRest(placed, crop[2], restPath);
  log(`mouths: ${character}: rest crop ${crop.join(",")} (rig px) from ${placed.length} layer(s)`);

  const shapes: Partial<Record<MouthShape, string>> = { rest: "rest.png" };
  const failed: Partial<Record<MouthShape, string>> = {};
  const wanted = MOUTH_SHAPES.filter((s) => s !== "rest" && (input.only === undefined || input.only.includes(s)));
  let calls = 0;
  const flat = editor === undefined ? undefined : await images.flatten(restPath, MODEL_INPUT_PX);
  for (const shape of wanted) {
    const file = `${shape}.png`;
    const out = join(outDir, file);
    if (editor === undefined || flat === undefined) {
      await images.placeholder(restPath, cropMouth(geometry), SHAPE_PARAMS[shape], out);
      shapes[shape] = file;
      continue;
    }
    calls += 1;
    try {
      const answer = await editor.edit({ mimeType: "image/png", data: flat }, shapePrompt(rig.name, shape));
      await images.fit(answer.data, crop[2], out);
      shapes[shape] = file;
      log(`mouths: ${character}: ${shape} ok`);
    } catch (error) {
      failed[shape] = error instanceof Error ? error.message : String(error);
      log(`mouths: ${character}: ${shape} failed (${failed[shape]}); L2 draws L1's mouth for it`);
    }
  }
  await rm(work, { recursive: true, force: true });
  if (editor !== undefined && wanted.length > 0 && Object.keys(failed).length === wanted.length) {
    throw new Error(`Every mouth shape failed for "${character}"; the first: ${Object.values(failed)[0] ?? "unknown"}`);
  }

  const at = (input.now?.() ?? new Date()).toISOString();
  const manifest: GenerateResult["manifest"] = {
    character,
    crop,
    shapes,
    source: editor === undefined ? "placeholder" : "gemini",
    ...(editor === undefined ? {} : { model: editor.model }),
    generatedAt: at,
    ...(Object.keys(failed).length === 0 ? {} : { failed }),
  };
  const cost: CostRecord = {
    character,
    source: manifest.source,
    ...(editor === undefined ? {} : { model: editor.model, usdPerCall: editor.usdPerEdit }),
    calls,
    usd: editor === undefined ? 0 : Math.round(calls * editor.usdPerEdit * 1000) / 1000,
    at,
  };
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(outDir, "cost.json"), `${JSON.stringify(cost, null, 2)}\n`);
  return { manifest, cost };
}
