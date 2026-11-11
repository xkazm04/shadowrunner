// The mouth ROI of a lab run: the union of the cast rig's jaw layer bboxes (rig canvas px), grown by the
// jaw's full drop below and a margin around, mapped to the stage the way the player fits the rig
// (contain, centred, 1920x1080: @sr/avatar's fitView, restated here because @sr/avatar/core carries
// DOM types the Node director's tsconfig does not load), then to the recording's resolution.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { JAW_DROP, MORPH_MOUTH_TRACKS, validateRig, type Rig } from "@sr/rig";
import { isRecord, readJsonFile } from "../director/json.js";
import { REPO_ROOT } from "../director/paths.js";
import type { Roi } from "./probe.js";

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const MARGIN = 0.25;
const FORGE_DIR = join(REPO_ROOT, "assets", "replay", "forge");
const COMPANIONS_DIR = join(REPO_ROOT, "assets", "replay", "companions");
/** Upward margin, as a fraction of the jaw height: the lips sit at or just above the jaw bbox top. */
const MARGIN_UP = 0.6;

/** @sr/avatar render/frame.ts fitView: the rig fitted whole into the stage, centred. */
export function fitStage(rig: Pick<Rig, "width" | "height">): { scale: number; ox: number; oy: number } {
  const scale = rig.width > 0 && rig.height > 0 ? Math.min(STAGE_W / rig.width, STAGE_H / rig.height) : 0;
  return { scale, ox: (STAGE_W - rig.width * scale) / 2, oy: (STAGE_H - rig.height * scale) / 2 };
}

/** Mouth ROI in recording px for `rig` drawn on the 1920x1080 stage, recorded at `width` x `height`. */
export function jawRoi(rig: Pick<Rig, "width" | "height" | "layers">, width: number, height: number): Roi {
  const jaws = rig.layers.filter((l) => l.kind === "jaw");
  if (jaws.length === 0) throw new Error(`Rig has no jaw layer, so there is no automatic mouth ROI; pass --roi x,y,w,h.`);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const j of jaws) {
    const [x, y, w, h] = j.bbox;
    const drop = (j.drop ?? JAW_DROP) * rig.height;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h + drop);
  }
  const mx = (x1 - x0) * MARGIN;
  const my = (y1 - y0) * MARGIN;
  const view = fitStage(rig);
  const sx = width / STAGE_W;
  const sy = height / STAGE_H;
  const left = Math.max(0, Math.floor(((x0 - mx) * view.scale + view.ox) * sx));
  const top = Math.max(0, Math.floor(((y0 - (y1 - y0) * MARGIN_UP) * view.scale + view.oy) * sy));
  const right = Math.min(width, Math.ceil(((x1 + mx) * view.scale + view.ox) * sx));
  const bottom = Math.min(height, Math.ceil(((y1 + my) * view.scale + view.oy) * sy));
  // Even sizes keep every ffmpeg crop/scale path happy.
  return { x: left, y: top, w: Math.max(2, (right - left) & ~1), h: Math.max(2, (bottom - top) & ~1) };
}

/**
 * Mouth ROI of a morph rig (companion-lanes: Iris, Bun have no jaw layer): the union of its mouth keys'
 * boxes (each key's box covers that shape at full weight, so the union holds every opening), a margin
 * around, mapped as `jawRoi` maps. Throws when the rig has no mouth key.
 */
export function morphMouthRoi(rig: Pick<Rig, "width" | "height" | "morph">, width: number, height: number): Roi {
  const keys = rig.morph?.keys.filter((k) => (MORPH_MOUTH_TRACKS as readonly string[]).includes(k.track)) ?? [];
  if (keys.length === 0) throw new Error(`Rig has no jaw layer and no morph mouth key, so there is no automatic mouth ROI; pass --roi x,y,w,h.`);
  const x0 = Math.min(...keys.map((k) => k.bbox[0]));
  const y0 = Math.min(...keys.map((k) => k.bbox[1]));
  const x1 = Math.max(...keys.map((k) => k.bbox[0] + k.bbox[2]));
  const y1 = Math.max(...keys.map((k) => k.bbox[1] + k.bbox[3]));
  const mx = (x1 - x0) * MARGIN;
  const my = (y1 - y0) * MARGIN;
  const view = fitStage(rig);
  const sx = width / STAGE_W;
  const sy = height / STAGE_H;
  const left = Math.max(0, Math.floor(((x0 - mx) * view.scale + view.ox) * sx));
  const top = Math.max(0, Math.floor(((y0 - my) * view.scale + view.oy) * sy));
  const right = Math.min(width, Math.ceil(((x1 + mx) * view.scale + view.ox) * sx));
  const bottom = Math.min(height, Math.ceil(((y1 + my) * view.scale + view.oy) * sy));
  return { x: left, y: top, w: Math.max(2, (right - left) & ~1), h: Math.max(2, (bottom - top) & ~1) };
}

/**
 * The ROI for character `character`. The rig is read where scripts/build-packs.mjs reads it to
 * build apps/web/public/packs/<id>.srpack (assets/replay/forge/<id>/job.json, or for a companion
 * assets/replay/companions/<id>/job.json), because @sr/pack's entry carries DOM types (ImageBitmap)
 * the Node director's tsconfig does not load. A rig with a jaw layer gets `jawRoi`, a morph rig
 * without one `morphMouthRoi`.
 */
export function castRoi(character: string, width: number, height: number): Roi {
  const file = [FORGE_DIR, COMPANIONS_DIR].map((dir) => join(dir, character, "job.json")).find((f) => existsSync(f));
  if (file === undefined) throw new Error(`No cast or companion rig for "${character}" under ${FORGE_DIR} or ${COMPANIONS_DIR}; pass --roi x,y,w,h.`);
  const job: unknown = readJsonFile(file);
  const checked = validateRig(isRecord(job) ? job.rig : undefined);
  if (!checked.ok) throw new Error(`${file}: the rig does not validate (${checked.errors[0]?.message ?? "unknown"}).`);
  const rig = checked.value;
  return rig.layers.some((l) => l.kind === "jaw") || rig.morph === undefined ? jawRoi(rig, width, height) : morphMouthRoi(rig, width, height);
}

/** "x,y,w,h" -> Roi; throws a sentence on anything else. */
export function parseRoi(text: string): Roi {
  const parts = text.split(",").map((p) => Number(p.trim()));
  const [x, y, w, h] = parts;
  if (parts.length !== 4 || x === undefined || y === undefined || w === undefined || h === undefined || !parts.every((n) => Number.isInteger(n) && n >= 0) || w < 2 || h < 2) {
    throw new Error(`--roi must be x,y,w,h in whole pixels (w and h at least 2), not "${text}".`);
  }
  return { x, y, w, h };
}
