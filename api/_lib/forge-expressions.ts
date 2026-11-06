// The live forge's expression steps (character-control design.md "Expressions", requirement 5.1).
// After assembly a job is `expressing` with `expressionIndex` 0; every GET runs one step. The first
// GET socketes the eyes (face-control, forge-eyes.ts: the iris-free and closed-eyes edits, an iris
// layer per eye); then one family per GET: the image edit (charged as COST_USD.expression), the edit
// laid back on the portrait (`registerEdit`), the stability gate (`faceStability`: over the limits
// the family is "skipped"), `cutVariants` (on a socketed rig cut to the brow+lid band), each socketed
// eye's patch re-read (`socketVariant`: iris painted out, its socket, `narrowed`), the patches stored
// as job assets and written into the rig's `variants`. A throw records "failed"; a refused charge
// (the daily budget), a face over the limits or an edit that changed no layer records "skipped" (the
// family stays procedural). Expressions never fail the forge: after the sixth family the job is `done`.
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Rig } from "@sr/rig";
import {
  cutVariants,
  decodeImage,
  encodePng,
  expressionPrompt,
  faceShape,
  faceStability,
  isBrowLayer,
  isStable,
  registerEdit,
  socketFile,
  socketVariant,
  type ExpressionOutcome,
  type ForgeJob,
  type Rgba,
} from "@sr/forge";
import { COST_USD } from "./costs.js";
import { eyesStep, liveSocketing } from "./forge-eyes.js";
import type { StepContext } from "./forge-steps.js";

/** One edit must leave the cut and the uploads room inside the 60 s invocation. */
export const EXPRESSION_TIMEOUT_MS = 40_000;

/** Decodes stored bytes, or throws (the family is then "failed"). */
function decoded(bytes: Uint8Array): Rgba {
  const image = decodeImage(bytes);
  if (!image.ok) throw new Error("expression: unreadable image");
  return image.value;
}

/** The layers `cutVariants` reads (head, eye, jaw, brow, and a crown on the head), decoded from the job's assets. */
async function faceLayers(rig: Rig, assets: Record<string, string>, ctx: StepContext): Promise<Map<string, Rgba>> {
  const out = new Map<string, Rgba>();
  for (const layer of rig.layers) {
    if (layer.kind !== "head" && layer.kind !== "eye" && layer.kind !== "jaw" && layer.kind !== "crown" && !isBrowLayer(layer.name)) continue;
    const url = assets[layer.file];
    if (url !== undefined) out.set(layer.name, decoded(await ctx.store.readImage(url)));
  }
  return out;
}

async function expressOne(job: ForgeJob, family: ExpressionFamily, ctx: StepContext): Promise<ExpressionOutcome> {
  const { rig, assets, portraitUrl, portraitMime } = job;
  if (rig === undefined || assets === undefined || portraitUrl === undefined || portraitMime === undefined) return "failed";
  const bytes = await ctx.store.readImage(portraitUrl);
  if (!(await ctx.charge(COST_USD.expression))) return "skipped";
  const prompt = expressionPrompt(job.brief?.name ?? rig.name, family, job.brief?.style.name);
  const edit = await ctx.gemini.editImage({ mimeType: portraitMime, data: bytes }, prompt, { timeoutMs: EXPRESSION_TIMEOUT_MS });
  const portrait = decoded(bytes);
  const raw = decoded(edit.data);
  if (raw.width !== portrait.width || raw.height !== portrait.height) return "failed";
  const layers = await faceLayers(rig, assets, ctx);
  const socketing = await liveSocketing(job, ctx);
  let edited = raw;
  if (socketing !== undefined) {
    const face = faceShape(rig, layers);
    edited = registerEdit(raw, portrait, rig, face).image;
    const stability = faceStability(edited, portrait, rig, face, socketing.stability);
    if (!isStable(stability, socketing.floor)) {
      console.warn(`forge: expression ${family} skipped (iris drift ${stability.irisDriftPx.toFixed(1)} px, outside the band ${stability.outsideBandMean.toFixed(1)})`);
      return "skipped";
    }
  }
  const cut = cutVariants(rig, layers, portrait, edited, family);
  const names = Object.keys(cut.patches);
  if ((socketing === undefined && cut.flagged) || names.length === 0) {
    console.warn(`forge: expression ${family} skipped (${cut.flagged ? `drift ${cut.drift.toFixed(1)}` : "no layer changed"})`);
    return "skipped";
  }
  const stored: Record<string, string> = {};
  const patches: Record<string, NonNullable<Rig["layers"][number]["variants"]>[ExpressionFamily]> = {};
  for (const name of names) {
    const entry = cut.patches[name];
    if (entry === undefined) continue;
    let { patch, image } = entry;
    const eye = socketing?.eyes.find((e) => e.name === name);
    if (eye !== undefined) {
      const v = socketVariant(eye, image);
      image = v.image;
      const socket = socketFile(`${name}.${family}`);
      stored[socket] = await ctx.store.putImage(job.jobId, socket, { bytes: encodePng(v.socket), contentType: "image/png" });
      patch = { ...patch, socket, ...(v.narrowed ? { narrowed: true as const } : {}) };
    }
    stored[patch.file] = await ctx.store.putImage(job.jobId, patch.file, { bytes: encodePng(image), contentType: "image/png" });
    patches[name] = patch;
  }
  job.assets = { ...assets, ...stored };
  job.rig = {
    ...rig,
    layers: rig.layers.map((layer) => {
      const patch = patches[layer.name];
      return patch === undefined ? layer : { ...layer, variants: { ...layer.variants, [family]: patch } };
    }),
  };
  return "ok";
}

/** One step of the `expressing` status (see the header): the eyes first, then one family per GET; the sixth moves the job to `done`. */
export async function expressStep(job: ForgeJob, ctx: StepContext): Promise<void> {
  if (job.eyes === undefined && ctx.eyes === false) job.eyes = "none";
  if (job.eyes === undefined) {
    try {
      await eyesStep(job, ctx);
    } catch (err) {
      console.warn(`forge: eyes failed (${err instanceof Error ? err.name : typeof err})`);
      job.eyes = "none";
    }
    return;
  }
  const index = job.expressionIndex ?? 0;
  const family = EXPRESSION_FAMILIES[index];
  if (family !== undefined) {
    let outcome: ExpressionOutcome;
    try {
      outcome = await expressOne(job, family, ctx);
    } catch (err) {
      console.warn(`forge: expression ${family} failed (${err instanceof Error ? err.name : typeof err})`);
      outcome = "failed";
    }
    job.expressions = { ...job.expressions, [family]: outcome };
  }
  if (index + 1 < EXPRESSION_FAMILIES.length) {
    job.expressionIndex = index + 1;
    return;
  }
  delete job.expressionIndex;
  job.status = "done";
}
