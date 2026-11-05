// The mouth ROI of a lab run: the union of the cast rig's jaw layer bboxes (rig canvas px), grown by the
// jaw's full drop below and a margin around, mapped to the stage the way the player fits the rig
// (contain, centred, 1920x1080: @sr/avatar's fitView, restated here because @sr/avatar/core carries
// DOM types the Node director's tsconfig does not load), then to the recording's resolution.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { JAW_DROP, validateRig, type Rig } from "@sr/rig";
import { isRecord, readJsonFile } from "../director/json.js";
import { REPO_ROOT } from "../director/paths.js";
import type { Roi } from "./probe.js";

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const MARGIN = 0.25;
const FORGE_DIR = join(REPO_ROOT, "assets", "replay", "forge");
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
 * The ROI for cast character `character`. The rig is read where scripts/build-packs.mjs reads it to
 * build apps/web/public/packs/<id>.srpack (assets/replay/forge/<id>/job.json), because @sr/pack's
 * entry carries DOM types (ImageBitmap) the Node director's tsconfig does not load.
 */
export function castRoi(character: string, width: number, height: number): Roi {
  const file = join(FORGE_DIR, character, "job.json");
  if (!existsSync(file)) throw new Error(`No cast rig for "${character}" at ${file}; pass --roi x,y,w,h.`);
  const job: unknown = readJsonFile(file);
  const checked = validateRig(isRecord(job) ? job.rig : undefined);
  if (!checked.ok) throw new Error(`${file}: the rig does not validate (${checked.errors[0]?.message ?? "unknown"}).`);
  return jawRoi(checked.value, width, height);
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
