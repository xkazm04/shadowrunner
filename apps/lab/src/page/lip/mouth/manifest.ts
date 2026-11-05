// The mouth-set manifest (var/lab/mouths/<character>/manifest.json): written by the Node
// generator (src/mouths), checked by the page before it fetches anything. No DOM, no Vite.
import { MOUTH_SHAPES, type MouthShape } from "./shapes.js";

export interface MouthSetManifest {
  character: string;
  /** The square the art covers, rig px. */
  crop: [x: number, y: number, side: number, side: number];
  /** Shape -> PNG file name in the set's folder. A missing shape falls back to L1's drawing. */
  shapes: Partial<Record<MouthShape, string>>;
  source: "gemini" | "placeholder";
  model?: string;
  generatedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The manifest, or a sentence saying what is wrong with it. */
export function readManifest(value: unknown): MouthSetManifest | string {
  if (!isRecord(value)) return "the manifest is not an object";
  const { character, crop, shapes, source, model, generatedAt } = value;
  if (typeof character !== "string" || character === "") return "character must be a non-empty string";
  if (!Array.isArray(crop) || crop.length !== 4 || !crop.every((n) => typeof n === "number" && Number.isFinite(n))) return "crop must be four numbers";
  if (!(crop[2] > 0) || crop[2] !== crop[3]) return "crop must be a square";
  if (!isRecord(shapes)) return "shapes must be an object";
  const out: Partial<Record<MouthShape, string>> = {};
  for (const [shape, file] of Object.entries(shapes)) {
    if (!(MOUTH_SHAPES as readonly string[]).includes(shape)) return `unknown shape "${shape}"`;
    if (typeof file !== "string" || !/^[A-Za-z0-9._-]+\.png$/.test(file)) return `shape ${shape} must name a .png in the set`;
    out[shape as MouthShape] = file;
  }
  if (source !== "gemini" && source !== "placeholder") return "source must be gemini or placeholder";
  if (typeof generatedAt !== "string") return "generatedAt must be a string";
  return {
    character,
    crop: [crop[0], crop[1], crop[2], crop[3]],
    shapes: out,
    source,
    ...(typeof model === "string" ? { model } : {}),
    generatedAt,
  };
}
