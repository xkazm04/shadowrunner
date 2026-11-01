// Forge steps on the live plane (forge-pipeline design.md, task 7). A job is client-driven: POST
// runs the first step (`startJob`), then every GET runs at most one more (`runStep`), each inside one
// function invocation. Server step order is parts -> fill -> cut -> assemble; the statuses the client
// sees move forward through queued -> portrait -> segmenting -> cutting -> filling -> done:
//   POST, mode prompt   portrait (final image model)                      -> segmenting
//   POST, mode image    likeness/content check, upload kept               -> portrait
//   GET  portrait       restyle the upload into the house style           -> segmenting
//   GET  segmenting     parts (a malformed reply is re-asked once, on the next GET) -> cutting
//   GET  cutting        fill edit, 30 s; on failure the job records fill "fallback" -> filling
//   GET  filling        blurExtend fallback if needed, cut, assemble, upload layers -> done
// Every failure becomes `failed` with a spec code and our own message; nothing upstream is copied.
import {
  CUT_FEATHER,
  FILL_PARTS,
  LIKENESS_PROMPT,
  PARTS_PROMPT,
  assembleRig,
  blurExtend,
  cutAll,
  decodeImage,
  dilateMask,
  emptyMask,
  fillPrompt,
  parseLikenessJson,
  parsePartsJson,
  portraitPrompt,
  rasterizeMask,
  restylePrompt,
  sniffImage,
  toCanvas,
  type ForgeErrorCode,
  type ForgeJob,
  type ForgeStep,
  type Part,
  type PortraitMime,
  type Rgba,
} from "@sr/forge";
import { COST_USD } from "./costs.js";
import { ApiError } from "./errors.js";
import type { GeminiClient, GeminiImage } from "./gemini.js";
import type { JobStore } from "./jobstore.js";

/** Requirement 2.5. */
export const PORTRAIT_SIZE = 1024;
/** Requirement 5.3: the fill edit gets 30 s, then the pure fallback paints the hole. */
export const FILL_TIMEOUT_MS = 30_000;
/** Image mode runs the check and the restyle in separate invocations; the check gets this long. */
export const CLASSIFY_TIMEOUT_MS = 20_000;
/** Parts requests per job: the first and one re-ask after a reply that is not JSON. */
export const MAX_PARTS_ASKS = 2;

export interface StepContext {
  gemini: GeminiClient;
  store: JobStore<ForgeJob>;
  /** Charges one further paid call of this forge (quota kind "forge", not counted per IP). */
  charge(usd: number): Promise<boolean>;
  now(): number;
}

const fail = (code: ForgeErrorCode, message: string) => new ApiError<ForgeErrorCode>(code, message);
const QUOTA = () => fail("quota", "The cellar's budget for today is spent. Try the recorded gallery.");

/** The image format of an upload by magic bytes: PNG, JPEG or WebP (requirement 2.4). */
export function uploadMime(bytes: Uint8Array): PortraitMime | undefined {
  const format = sniffImage(bytes);
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  const tag = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length >= 12 && tag(0, 4) === "RIFF" && tag(8, 12) === "WEBP" ? "image/webp" : undefined;
}

function extensionOf(mime: string): "png" | "jpg" | "webp" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/** Decodes a generated portrait (or plate) and holds it to 1024 x 1024. */
function decodePortrait(bytes: Uint8Array): Rgba {
  const decoded = decodeImage(bytes);
  if (!decoded.ok) throw fail("upstream", "The forge painted something unreadable.");
  if (decoded.value.width !== PORTRAIT_SIZE || decoded.value.height !== PORTRAIT_SIZE) {
    throw fail("upstream", "The forge painted the wrong size.");
  }
  return decoded.value;
}

async function timed<T>(job: ForgeJob, step: ForgeStep, now: () => number, work: () => Promise<T>): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    job.timings = { ...job.timings, [step]: Math.max(0, Math.round(now() - started)) };
  }
}

async function savePortrait(job: ForgeJob, image: GeminiImage, ctx: StepContext): Promise<void> {
  const mime = uploadMime(image.data);
  if (mime === undefined || mime === "image/webp") throw fail("upstream", "The forge painted something unreadable.");
  decodePortrait(image.data);
  job.portraitUrl = await ctx.store.putImage(job.jobId, `portrait.${extensionOf(mime)}`, { bytes: image.data, contentType: mime });
  job.portraitMime = mime;
  job.status = "segmenting";
}

async function readJobImage(ctx: StepContext, url: string | undefined, mime: PortraitMime | undefined): Promise<GeminiImage> {
  if (url === undefined || mime === undefined) throw fail("upstream", "The forge lost its portrait.");
  return { mimeType: mime, data: await ctx.store.readImage(url) };
}

/**
 * The first step, run by POST after quota has counted this forge. Mode prompt: the portrait.
 * Mode image: the likeness and content check on the upload, which is kept for the restyle.
 */
export async function startJob(job: ForgeJob, upload: { bytes: Uint8Array; mime: PortraitMime } | undefined, ctx: StepContext): Promise<ForgeJob> {
  return guarded(job, async () => {
    if (job.mode === "prompt") {
      job.status = "portrait";
      const image = await timed(job, "portrait", ctx.now, () => ctx.gemini.generateImage(portraitPrompt(job.prompt ?? "")));
      await savePortrait(job, image, ctx);
      return;
    }
    if (upload === undefined) throw fail("bad_input", "Choose an image.");
    const source = { mimeType: upload.mime, data: upload.bytes };
    const reply = await timed(job, "classify", ctx.now, () => ctx.gemini.generateJson(LIKENESS_PROMPT, source, { timeoutMs: CLASSIFY_TIMEOUT_MS }));
    const verdict = parseLikenessJson(reply);
    if (verdict === undefined) throw fail("upstream", "The forge could not judge this image. Try again.");
    if (verdict.realPerson) throw fail("refused_likeness", "This looks like a real person. The forge only makes original characters.");
    if (verdict.unsafe) throw fail("refused_content", "The forge will not use this image.");
    job.uploadUrl = await ctx.store.putImage(job.jobId, `upload.${extensionOf(upload.mime)}`, { bytes: upload.bytes, contentType: upload.mime });
    job.uploadMime = upload.mime;
    job.status = "portrait";
  });
}

/** Runs the step for the job's status and returns the updated job; done and failed jobs stay as they are. */
export async function runStep(job: ForgeJob, ctx: StepContext): Promise<ForgeJob> {
  switch (job.status) {
    case "portrait":
      return guarded(job, () => restyle(job, ctx));
    case "segmenting":
      return guarded(job, () => parts(job, ctx));
    case "cutting":
      return guarded(job, () => fillEdit(job, ctx));
    case "filling":
      return guarded(job, () => cutAndAssemble(job, ctx));
    default:
      return job;
  }
}

/** Any throw fails the job: an ApiError keeps its code and message, anything else is `upstream`. */
async function guarded(job: ForgeJob, work: () => Promise<void>): Promise<ForgeJob> {
  try {
    await work();
  } catch (err) {
    const known = err instanceof ApiError && isForgeCode(err.code);
    job.status = "failed";
    job.error = known ? { code: err.code, message: err.message } : { code: "upstream", message: "The forge failed. Try again." };
    console.warn(`forge: job failed: ${job.error.code}${known ? "" : ` (${err instanceof Error ? err.name : typeof err})`}`);
  }
  return job;
}

const FORGE_CODES: readonly string[] = ["quota", "refused_likeness", "refused_content", "upstream", "bad_input"] satisfies ForgeErrorCode[];
const isForgeCode = (code: string): code is ForgeErrorCode => FORGE_CODES.includes(code);

async function restyle(job: ForgeJob, ctx: StepContext): Promise<void> {
  const upload = await readJobImage(ctx, job.uploadUrl, job.uploadMime);
  if (!(await ctx.charge(COST_USD.imageFinal))) throw QUOTA();
  const image = await timed(job, "portrait", ctx.now, () => ctx.gemini.editImage(upload, restylePrompt()));
  await savePortrait(job, image, ctx);
}

async function parts(job: ForgeJob, ctx: StepContext): Promise<void> {
  const portrait = await readJobImage(ctx, job.portraitUrl, job.portraitMime);
  if (!(await ctx.charge(COST_USD.segment))) throw QUOTA();
  job.partsAsks = (job.partsAsks ?? 0) + 1;
  const reply = await timed(job, "parts", ctx.now, () => ctx.gemini.generateJson(PARTS_PROMPT, portrait));
  const parsed = parsePartsJson(reply);
  if (parsed.ok) {
    job.parts = parsed.value.parts;
    job.status = "cutting";
    return;
  }
  // Not JSON at all: ask once more on the next GET. Off-contract JSON is final (requirement 3.2).
  if (parsed.errors.syntax && job.partsAsks < MAX_PARTS_ASKS) return;
  console.warn(`forge: parts rejected: ${parsed.errors.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  throw fail("upstream", "The forge could not find the face's parts. Try again.");
}

/** The FILL_PARTS this job's portrait has, in FILL_PARTS order: the one list behind both fills. */
function liftedParts(job: ForgeJob): Part[] {
  return FILL_PARTS.flatMap((name) => job.parts?.find((p) => p.name === name) ?? []);
}

async function fillEdit(job: ForgeJob, ctx: StepContext): Promise<void> {
  const lifted = liftedParts(job);
  job.status = "filling";
  job.fill = "fallback";
  if (lifted.length === 0) return;
  const portrait = await readJobImage(ctx, job.portraitUrl, job.portraitMime);
  if (!(await ctx.charge(COST_USD.imageEdit))) return; // over budget: the free fallback paints it
  try {
    const plate = await timed(job, "fill", ctx.now, () =>
      ctx.gemini.editImage(portrait, fillPrompt(lifted.map((p) => p.name)), { timeoutMs: FILL_TIMEOUT_MS }),
    );
    const mime = uploadMime(plate.data);
    if (mime === undefined || mime === "image/webp") return;
    decodePortrait(plate.data); // wrong size or unreadable: fall back rather than fail
    job.plateUrl = await ctx.store.putImage(job.jobId, `plate.${extensionOf(mime)}`, { bytes: plate.data, contentType: mime });
    job.fill = "edit";
  } catch {
    // Requirement 5.3: an edit that fails or times out leaves fill "fallback".
  }
}

/** The pure fallback plate: the FILL_PARTS polygons, grown past their feather, painted by blurExtend. */
export function fallbackPlate(portrait: Rgba, lifted: readonly Part[]): Rgba {
  const { width, height } = portrait;
  const hole = emptyMask(width, height);
  for (const part of lifted) {
    rasterizeMask(toCanvas(part.poly, width, height), width, height, 0).data.forEach((a, i) => {
      if (a !== 0) hole.data[i] = 255;
    });
  }
  return blurExtend(portrait, dilateMask(hole, CUT_FEATHER + 1));
}

async function cutAndAssemble(job: ForgeJob, ctx: StepContext): Promise<void> {
  const parts = job.parts;
  if (parts === undefined) throw fail("upstream", "The forge lost the face's parts.");
  const portraitImage = await readJobImage(ctx, job.portraitUrl, job.portraitMime);
  const portrait = decodePortrait(portraitImage.data);
  const assembled = await timed(job, "cut", ctx.now, async () => {
    let plate: Rgba;
    if (job.fill === "edit" && job.plateUrl !== undefined) {
      plate = decodePortrait(await ctx.store.readImage(job.plateUrl));
    } else {
      plate = fallbackPlate(portrait, liftedParts(job));
      job.fill = "fallback";
    }
    // A plate/portrait size mismatch throws RangeError in cutAll/assembleRig; `guarded` maps it to upstream.
    const cut = cutAll(portrait, parts, { plate });
    return assembleRig(parts, cut.layers, { id: `forge-${job.jobId.slice(0, 12)}`, name: "Forged character", portrait, plate });
  });
  if (!assembled.ok) {
    console.warn(`forge: rig invalid: ${assembled.errors.map((e) => e.code).join(", ")}`);
    throw fail("upstream", "The forge could not assemble a working face. Try again.");
  }
  const assets: Record<string, string> = {};
  for (const [file, bytes] of Object.entries(assembled.value.files)) {
    assets[file] = await ctx.store.putImage(job.jobId, file, { bytes, contentType: "image/png" });
  }
  job.rig = assembled.value.rig;
  job.assets = assets;
  job.status = "done";
}
