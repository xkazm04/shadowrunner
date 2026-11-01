// Forge spike (forge-pipeline task 1, requirement 1). Owner-only, paid, never run by tests.
//   GEMINI_API_KEY=... node scripts/forge-spike.mjs [--force]
//   GEMINI_API_KEY=... node scripts/forge-spike.mjs --parts-only <image> [--force]
// End to end (task 1.2): for 3 preset prompts (assets/characters/presets/PROMPTS.md, characters 1,
// 3 and 5) it runs the SERVER pipeline itself (api/_lib/forge-steps.ts with the real Gemini client
// from api/_lib/gemini.ts, the server's timeouts, a memory job store and no quota): portrait ->
// parts (one re-ask on malformed JSON) -> fill edit (30 s, blurExtend fallback) -> cut -> assemble.
// Per portrait it writes under var/forge-spike/<slug>/: portrait, parts.json, overlay.png, the
// rig, every layer PNG, and composite.png (portrait | layers composited | jaw opened), and a
// summary.json with step timings, part count, the validateRig result and the fill mode.
// --parts-only (task 2.2, ruling (a)): one PARTS_PROMPT call on an existing PNG/JPEG, raw reply kept.
//
// Paid-call discipline: no call is retried (the server does not retry either; the parts step's one
// re-ask is part of the pipeline), and the script refuses to run again over an existing
// var/forge-spike/summary.json without --force. The key reaches only the Gemini client, which
// sends it in the x-goog-api-key header; it is never printed or written, and error messages are ours.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { runnerImport } from "vite";

const OUT = join("var", "forge-spike");
const load = async (id) => (await runnerImport(id)).module;
const forge = await load("/packages/forge/src/index.ts");
const { validateRig } = await load("/packages/rig/src/index.ts");
const { createGemini, geminiModels } = await load("/api/_lib/gemini.ts");
const { MemoryJobStore, newJobId } = await load("/api/_lib/jobstore.ts");
const { startJob, runStep } = await load("/api/_lib/forge-steps.ts");

const presets = readFileSync(join("assets", "characters", "presets", "PROMPTS.md"), "utf8");
function presetText(n) {
  const section = presets.split(/\n## /).find((s) => s.startsWith(`${n}. `));
  const match = section?.match(/\*\*Character[^\n]*\n((?:>.*\n?)+)/);
  if (!match) throw new Error(`forge-spike: no Character text for preset ${n}`);
  return match[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ");
}
const CHARACTERS = [
  { slug: "lantern-warden", preset: 1, expected: ["head", "jaw", "eye_l", "eye_r", "hat", "torso"] },
  { slug: "understudy", preset: 3, expected: ["head", "jaw", "eye_l", "eye_r", "accessory", "torso"] },
  { slug: "announcer-of-dead-air", preset: 5, expected: ["head", "jaw", "eye_l", "eye_r", "hat", "crown", "torso"] },
].map((c) => ({ ...c, text: presetText(c.preset) }));

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("forge-spike: GEMINI_API_KEY is not set. This spike makes paid calls and needs the owner's key.");
  process.exit(2);
}
const FORCE = process.argv.includes("--force");
const PARTS_ONLY = process.argv.includes("--parts-only") ? process.argv[process.argv.indexOf("--parts-only") + 1] : undefined;
if (process.argv.includes("--parts-only") && (!PARTS_ONLY || PARTS_ONLY.startsWith("--") || !existsSync(PARTS_ONLY))) {
  console.error("forge-spike: --parts-only needs an existing PNG or JPEG path.");
  process.exit(2);
}
const GUARD = PARTS_ONLY ? join(OUT, "parts-only", basename(PARTS_ONLY, extname(PARTS_ONLY)), "run.json") : join(OUT, "summary.json");
if (existsSync(GUARD) && !FORCE) {
  console.error(`forge-spike: ${GUARD} exists. Re-running spends money again; pass --force to do it anyway.`);
  process.exit(2);
}
const scrub = (s) => String(s).split(KEY).join("[redacted]").slice(0, 400);

/** The server's Gemini client, with every call and failure reason logged for the record (no bodies). */
const models = geminiModels(process.env);
const calls = [];
/** Raw JSON replies, kept for the record (parts.raw.txt), never parsed here. */
const raws = [];
const real = createGemini({ apiKey: KEY, models });
const logged = (kind, fn) => async (...args) => {
  const started = performance.now();
  try {
    const out = await fn(...args);
    calls.push({ kind, ms: Math.round(performance.now() - started), ok: true });
    if (kind === "generateJson") raws.push(out);
    return out;
  } catch (err) {
    calls.push({ kind, ms: Math.round(performance.now() - started), ok: false, reason: err?.reason ?? err?.name, httpStatus: err?.httpStatus });
    throw err;
  }
};
const gemini = {
  models: real.models,
  generateImage: logged("generateImage", real.generateImage),
  editImage: logged("editImage", (image, prompt, options) => real.editImage(image, prompt, options)),
  generateJson: logged("generateJson", real.generateJson),
};

// ---- images: decode, overlay, composite (pure JS through @sr/forge) ----
const COLOURS = { head: [255, 80, 80], jaw: [255, 200, 40], eye_l: [60, 140, 255], eye_r: [60, 220, 255], monocle: [200, 120, 255], crown: [255, 120, 220], torso: [80, 255, 120], hat: [255, 150, 60], hair: [180, 255, 60], accessory: [255, 255, 255] };
const fromDataUrl = (url) => new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
const decode = (bytes) => {
  const d = forge.decodeImage(bytes);
  if (!d.ok) throw new Error(`decode failed: ${d.errors.message}`);
  return d.value;
};

function overlay(img, parts) {
  const out = { width: img.width, height: img.height, data: img.data.slice() };
  for (const part of parts) {
    const [r, g, b] = COLOURS[part.name] ?? [128, 128, 128];
    const mask = forge.rasterizeMask(forge.toCanvas(part.poly, img.width, img.height), img.width, img.height, 0);
    const edge = forge.dilateMask(mask, 2);
    for (let i = 0; i < mask.data.length; i++) {
      const a = mask.data[i] ? (edge.data[i] && !isInterior(mask, i, 2) ? 1 : 0.22) : edge.data[i] ? 1 : 0;
      if (a === 0) continue;
      out.data[i * 4] = out.data[i * 4] * (1 - a) + r * a;
      out.data[i * 4 + 1] = out.data[i * 4 + 1] * (1 - a) + g * a;
      out.data[i * 4 + 2] = out.data[i * 4 + 2] * (1 - a) + b * a;
    }
  }
  return out;
}
function isInterior(mask, i, r) {
  const x = i % mask.width, y = Math.floor(i / mask.width);
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!mask.data[(y + dy) * mask.width + x + dx]) return false;
  return true;
}

/** The rig's layers composited back to front over black; `jawPx` moves the jaw layer down. */
function composite(rig, assets, jawPx) {
  const { width, height } = rig;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
    const img = decode(fromDataUrl(assets[layer.file]));
    const [bx, by] = layer.bbox;
    const dy = layer.kind === "jaw" ? jawPx : 0;
    for (let y = 0; y < img.height; y++) {
      const ty = Math.round(by) + y + dy;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < img.width; x++) {
        const tx = Math.round(bx) + x;
        if (tx < 0 || tx >= width) continue;
        const s = (y * img.width + x) * 4, t = (ty * width + tx) * 4, a = img.data[s + 3] / 255;
        for (let c = 0; c < 3; c++) data[t + c] = img.data[s + c] * a + data[t + c] * (1 - a);
      }
    }
  }
  return { width, height, data };
}
function sideBySide(images) {
  const { height } = images[0];
  const width = images.reduce((w, im) => w + im.width, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < height; y++) data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * width + x0) * 4);
    x0 += im.width;
  }
  return { width, height, data };
}

// ---- --parts-only ----
if (PARTS_ONLY) {
  const bytes = new Uint8Array(readFileSync(PARTS_ONLY));
  const format = forge.sniffImage(bytes);
  const dir = join(OUT, "parts-only", basename(PARTS_ONLY, extname(PARTS_ONLY)));
  mkdirSync(dir, { recursive: true });
  const run = { ranAt: new Date().toISOString(), segmentModel: models.segment, image: PARTS_ONLY.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") };
  try {
    const started = performance.now();
    const raw = await gemini.generateJson(forge.PARTS_PROMPT, { mimeType: format === "png" ? "image/png" : "image/jpeg", data: bytes });
    run.partsMs = Math.round(performance.now() - started);
    writeFileSync(join(dir, "parts.raw.txt"), raw);
    const parsed = forge.parsePartsJson(raw);
    run.parsed = parsed.ok;
    if (parsed.ok) writeFileSync(join(dir, "parts.json"), `${JSON.stringify(parsed.value.parts, null, 2)}\n`);
  } catch (err) {
    run.error = scrub(err?.message ?? err);
    process.exitCode = 1;
  }
  writeFileSync(join(dir, "run.json"), `${JSON.stringify({ ...run, calls }, null, 2)}\n`);
  console.log(`forge-spike: wrote ${join(dir, "run.json")}`);
  process.exit();
}

// ---- end to end ----
mkdirSync(OUT, { recursive: true });
const ranAt = new Date().toISOString();
const results = [];
for (const c of CHARACTERS) {
  const dir = join(OUT, c.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "prompt.txt"), `${forge.portraitPrompt(c.text)}\n`);
  const store = new MemoryJobStore();
  const ctx = { gemini, store, charge: async () => true, now: () => performance.now() };
  const firstCall = calls.length;
  const firstRaw = raws.length;
  const result = { slug: c.slug, preset: c.preset, expected: c.expected, steps: [] };
  results.push(result);
  console.log(`forge-spike: ${c.slug}: running the server pipeline...`);
  let job = { jobId: newJobId(), plane: "live", mode: "prompt", status: "queued", createdAt: Date.now(), prompt: c.text };
  const wall = performance.now();
  for (let i = 0; i < 8 && job.status !== "done" && job.status !== "failed"; i++) {
    const from = job.status, t = performance.now();
    job = i === 0 ? await startJob(job, undefined, ctx) : await runStep(job, ctx);
    result.steps.push({ from, to: job.status, ms: Math.round(performance.now() - t) });
    console.log(`forge-spike: ${c.slug}: ${from} -> ${job.status} (${result.steps.at(-1).ms} ms)`);
  }
  Object.assign(result, {
    status: job.status,
    totalMs: Math.round(performance.now() - wall),
    timings: job.timings,
    partsAsks: job.partsAsks,
    fill: job.fill,
    error: job.error,
    calls: calls.slice(firstCall),
  });
  raws.slice(firstRaw).forEach((raw, i) => writeFileSync(join(dir, i === 0 ? "parts.raw.txt" : `parts.raw.${i + 1}.txt`), raw));
  if (job.portraitUrl) {
    const bytes = fromDataUrl(job.portraitUrl);
    writeFileSync(join(dir, `portrait.${job.portraitMime === "image/png" ? "png" : "jpg"}`), bytes);
    const img = decode(bytes);
    Object.assign(result, { width: img.width, height: img.height, mimeType: job.portraitMime });
    if (job.parts) {
      writeFileSync(join(dir, "parts.json"), `${JSON.stringify(job.parts, null, 2)}\n`);
      writeFileSync(join(dir, "overlay.png"), forge.encodePng(overlay(img, job.parts)));
      const found = job.parts.map((p) => p.name);
      Object.assign(result, { partCount: found.length, found, missingExpected: c.expected.filter((n) => !found.includes(n)), overlay: join(dir, "overlay.png") });
    }
    if (job.plateUrl) writeFileSync(join(dir, `plate.${job.plateUrl.startsWith("data:image/png") ? "png" : "jpg"}`), fromDataUrl(job.plateUrl));
    if (job.rig && job.assets) {
      const checked = validateRig(job.rig);
      result.validateRig = checked.ok ? "ok" : checked.errors.map((e) => e.code);
      result.layers = job.rig.layers.map((l) => l.name);
      writeFileSync(join(dir, "rig.json"), `${JSON.stringify(job.rig, null, 2)}\n`);
      for (const [file, url] of Object.entries(job.assets)) writeFileSync(join(dir, `layer-${file}`), fromDataUrl(url));
      const jawPx = Math.round(job.rig.height * 0.03);
      writeFileSync(join(dir, "composite.png"), forge.encodePng(sideBySide([img, composite(job.rig, job.assets, 0), composite(job.rig, job.assets, jawPx)])));
      result.composite = join(dir, "composite.png");
      result.jawOpenPx = jawPx;
    }
  }
  if (job.error) console.error(`forge-spike: ${c.slug}: failed: ${job.error.code} (${scrub(job.error.message)})`);
}

const summary = { ranAt, models, pipeline: "api/_lib/forge-steps.ts (server code, server timeouts)", results };
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`forge-spike: wrote ${join(OUT, "summary.json")}`);
