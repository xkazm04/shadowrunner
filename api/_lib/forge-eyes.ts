// The live forge's eye step (face-control, WP-B): the first GET of `expressing` socketes the eyes as
// the cast tools do (scripts/cast/eyes.mjs): the iris-free edit (`irisFreePrompt`) and the
// closed-eyes edit (`closedEyesPrompt`) run in parallel on the image model (each charged as
// COST_USD.imageEdit; refused, failed or late edits leave the pure fallbacks: a procedural sclera
// fill, the plate's lids), then `socketEyes` turns each eye it can read into an iris-free eye with
// its socket and closed art plus an iris layer. The painted eyes and the edits are kept as job assets
// (`<eye>.painted.png`, `iris-free.png`) so every later expression GET re-reads the same socketing
// (`liveSocketing`) without the 50 KB job record carrying pixels. An eye it is unsure of stays one
// piece; no eye socketed leaves the rig as it was (`eyes: "none"`).
import { closedEyesPrompt, decodeImage, encodePng, faceShape, faceStability, irisFreePrompt, registerEdit, socketEyes, unsocketed, type EyeSocketing, type ForgeJob, type Rgba, type StabilityEye } from "@sr/forge";
import type { Rig } from "@sr/rig";
import { COST_USD } from "./costs.js";
import type { StepContext } from "./forge-steps.js";

/** Both edits run at once and must leave the cut and the uploads room inside the 60 s invocation. */
export const EYES_TIMEOUT_MS = 35_000;
export const IRIS_FREE_FILE = "iris-free.png";
export const paintedFile = (eye: string): string => `${eye}.painted.png`;

function decoded(bytes: Uint8Array): Rgba | undefined {
  const image = decodeImage(bytes);
  return image.ok ? image.value : undefined;
}

/** One edit of the portrait, or undefined when refused by the budget, failed, late, unreadable or the wrong size. */
async function edit(job: ForgeJob, ctx: StepContext, prompt: string, portrait: Rgba): Promise<Rgba | undefined> {
  if (job.portraitUrl === undefined || job.portraitMime === undefined) return undefined;
  if (!(await ctx.charge(COST_USD.imageEdit))) return undefined;
  try {
    const bytes = await ctx.store.readImage(job.portraitUrl);
    const out = decoded((await ctx.gemini.editImage({ mimeType: job.portraitMime, data: bytes }, prompt, { timeoutMs: EYES_TIMEOUT_MS })).data);
    if (out === undefined || out.width !== portrait.width || out.height !== portrait.height) return undefined;
    // An edit that changed nothing did not happen: the fallbacks paint instead.
    let moved = 0;
    for (let i = 0; i < out.data.length && moved === 0; i++) if (Math.abs((out.data[i] ?? 0) - (portrait.data[i] ?? 0)) > 8) moved = 1;
    return moved === 0 ? undefined : out;
  } catch {
    return undefined;
  }
}

async function layerImages(rig: Rig, assets: Record<string, string>, ctx: StepContext, painted = false): Promise<Record<string, Rgba>> {
  const out: Record<string, Rgba> = {};
  for (const layer of rig.layers) {
    const url = assets[painted && layer.kind === "eye" ? paintedFile(layer.name) : layer.file] ?? assets[layer.file];
    const image = url === undefined ? undefined : decoded(await ctx.store.readImage(url));
    if (image !== undefined) out[layer.file] = image;
  }
  return out;
}

/** The eye step (see the header). */
export async function eyesStep(job: ForgeJob, ctx: StepContext): Promise<void> {
  const { rig, assets, portraitUrl } = job;
  job.eyes = "none";
  if (rig === undefined || assets === undefined || portraitUrl === undefined || !rig.layers.some((l) => l.kind === "eye")) return;
  const portrait = decoded(await ctx.store.readImage(portraitUrl));
  if (portrait === undefined) return;
  const name = job.brief?.name ?? rig.name;
  const style = job.brief?.style.name;
  const [clean, closed] = await Promise.all([edit(job, ctx, irisFreePrompt(name, style), portrait), edit(job, ctx, closedEyesPrompt(name, style), portrait)]);
  const images = await layerImages(rig, assets, ctx);
  const out = socketEyes(rig, images, { ...(clean === undefined ? {} : { clean }), ...(closed === undefined ? {} : { closed }) });
  for (const note of out.notes) console.warn(`forge: ${note}`);
  if (out.eyes.length === 0) return;
  const stored: Record<string, string> = {};
  const put = async (file: string, image: Rgba) => (stored[file] = await ctx.store.putImage(job.jobId, file, { bytes: encodePng(image), contentType: "image/png" }));
  for (const eye of out.eyes) await put(paintedFile(eye.name), eye.original);
  if (clean !== undefined) await put(IRIS_FREE_FILE, clean);
  for (const [file, image] of Object.entries(out.files)) await put(file, image);
  job.assets = { ...assets, ...stored };
  job.rig = out.rig;
  job.eyes = clean === undefined ? "fallback" : "edit";
}

export interface LiveSocketing {
  eyes: EyeSocketing[];
  stability: Record<string, StabilityEye>;
  /** The image model's re-render floor outside the brow+lid band (from the iris-free edit), when there is one. */
  floor?: number;
}

/** The job's socketing again (see the header), or undefined when its rig has no iris layer. */
export async function liveSocketing(job: ForgeJob, ctx: StepContext): Promise<LiveSocketing | undefined> {
  const { rig, assets, portraitUrl } = job;
  if (rig === undefined || assets === undefined || portraitUrl === undefined || !rig.layers.some((l) => l.kind === "iris")) return undefined;
  const portrait = decoded(await ctx.store.readImage(portraitUrl));
  if (portrait === undefined) return undefined;
  const before = unsocketed(rig);
  const cleanUrl = assets[IRIS_FREE_FILE];
  const clean = cleanUrl === undefined ? undefined : decoded(await ctx.store.readImage(cleanUrl));
  const { eyes } = socketEyes(before, await layerImages(before, assets, ctx, true), clean === undefined ? {} : { clean });
  const tint = [1, 3, 5].map((i) => parseInt(rig.palette.eye.slice(i, i + 2), 16)) as [number, number, number];
  const stability: Record<string, StabilityEye> = {};
  for (const eye of eyes) {
    const layer = rig.layers.find((l) => l.name === eye.name);
    if (layer === undefined) continue;
    stability[eye.name] = { bbox: layer.bbox, iris: { cx: layer.bbox[0] + eye.iris.cx, cy: layer.bbox[1] + eye.iris.cy, r: eye.iris.r }, look: eye.look, tint };
  }
  let floor: number | undefined;
  if (clean !== undefined) {
    const layers = new Map<string, Rgba>();
    const images = await layerImages(rig, assets, ctx);
    for (const layer of rig.layers) if (images[layer.file] !== undefined) layers.set(layer.name, images[layer.file] as Rgba);
    const face = faceShape(rig, layers);
    floor = faceStability(registerEdit(clean, portrait, rig, face).image, portrait, rig, face, {}).outsideBandMean;
  }
  return { eyes, stability, ...(floor === undefined ? {} : { floor }) };
}
