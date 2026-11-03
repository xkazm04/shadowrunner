// The live forge's expression steps (character-control design.md "Expressions", requirement 5.1).
// After assembly a job is `expressing` with `expressionIndex` 0; every GET runs one family: the
// image edit (charged as COST_USD.expression), `cutVariants`, the patches stored as job assets and
// written into the rig's `variants`. A throw records "failed"; a refused charge (the daily budget),
// a drift over the limit or an edit that changed no layer records "skipped" (the family stays
// procedural). Expressions never fail the forge: after the sixth family the job is `done`.
import { EXPRESSION_FAMILIES, type ExpressionFamily, type Rig } from "@sr/rig";
import { cutVariants, decodeImage, encodePng, expressionPrompt, isBrowLayer, type ExpressionOutcome, type ForgeJob, type Rgba } from "@sr/forge";
import { COST_USD } from "./costs.js";
import type { StepContext } from "./forge-steps.js";

/** One edit must leave the cut and the uploads room inside the 60 s invocation. */
export const EXPRESSION_TIMEOUT_MS = 40_000;

/** Decodes stored bytes, or throws (the family is then "failed"). */
function decoded(bytes: Uint8Array): Rgba {
  const image = decodeImage(bytes);
  if (!image.ok) throw new Error("expression: unreadable image");
  return image.value;
}

/** The layers `cutVariants` reads (head, eye, jaw, brow), decoded from the job's assets. */
async function faceLayers(rig: Rig, assets: Record<string, string>, ctx: StepContext): Promise<Map<string, Rgba>> {
  const out = new Map<string, Rgba>();
  for (const layer of rig.layers) {
    if (layer.kind !== "head" && layer.kind !== "eye" && layer.kind !== "jaw" && !isBrowLayer(layer.name)) continue;
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
  const edited = decoded(edit.data);
  if (edited.width !== portrait.width || edited.height !== portrait.height) return "failed";
  const cut = cutVariants(rig, await faceLayers(rig, assets, ctx), portrait, edited, family);
  const names = Object.keys(cut.patches);
  if (cut.flagged || names.length === 0) {
    console.warn(`forge: expression ${family} skipped (${cut.flagged ? `drift ${cut.drift.toFixed(1)}` : "no layer changed"})`);
    return "skipped";
  }
  const stored: Record<string, string> = {};
  for (const name of names) {
    const { patch, image } = cut.patches[name] ?? {};
    if (patch === undefined || image === undefined) continue;
    stored[patch.file] = await ctx.store.putImage(job.jobId, patch.file, { bytes: encodePng(image), contentType: "image/png" });
  }
  job.assets = { ...assets, ...stored };
  job.rig = {
    ...rig,
    layers: rig.layers.map((layer) => {
      const patch = cut.patches[layer.name]?.patch;
      return patch === undefined ? layer : { ...layer, variants: { ...layer.variants, [family]: patch } };
    }),
  };
  return "ok";
}

/** One family of the `expressing` status (see the header); the sixth moves the job to `done`. */
export async function expressStep(job: ForgeJob, ctx: StepContext): Promise<void> {
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
