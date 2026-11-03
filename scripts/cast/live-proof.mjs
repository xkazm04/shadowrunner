// Cast-forge task 11 offline proof: the product path and the overnight path are one path.
//   node scripts/cast/live-proof.mjs <slug>
// Runs the LIVE forge steps (api/_lib/forge-steps.ts: startJob, runStep) for a brief job against a
// fake Gemini client that answers with the cast character's committed files: portrait.png as the
// portrait, parts.json as the parts model's answer to partsPromptFromBrief, fill.jpg as the fill
// edit. The brief is the character's recorded brief with its parts plan set to the decomposition's
// parts (name, role, follow; the recorded words where a name matches). No network, no key.
// Compares the live rig and every layer's pixels with the committed replay job
// (assets/replay/forge/<slug>/) and writes var/cast-forge/task11-<slug>.png: replay over live over
// |replay - live| x16, at rest, jaw open, head turned and motion at t = 1.7 s. Exits 1 on a difference.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { text } from "./overlay.mjs";
import { imagesOf, loadPipeline, sideBySide } from "../forge-lib.mjs";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("usage: node scripts/cast/live-proof.mjs <slug>");
const DIR = join("assets", "characters", "cast", slug);
const REPLAY = join("assets", "replay", "forge", slug);
const { forge, steps, rigCore } = await loadPipeline();
const { module: jobstore } = await runnerImport("/api/_lib/jobstore.ts");

/** The recorded brief, its parts plan set to the decomposition's parts. */
export function proofBrief(recorded, partsFile) {
  const base = forge.briefFromRecorded(recorded);
  if (!base.ok) throw new Error(`${slug}: brief.json: ${base.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  const words = new Map(base.value.parts.map((p) => [p.name, p]));
  const parts = partsFile.parts.map((p) => ({
    name: p.name,
    role: p.role,
    what: words.get(p.name)?.what ?? p.name.replaceAll("_", " "),
    ...(p.motion === undefined ? {} : { motion: words.get(p.name)?.motion ?? "moves on its own" }),
    ...(p.follow === undefined ? {} : { follow: p.follow }),
  }));
  const brief = forge.parseBrief({ ...base.value, parts });
  if (!brief.ok) throw new Error(`${slug}: proof brief: ${brief.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  return brief.value;
}

const partsText = readFileSync(join(DIR, "parts.json"), "utf8");
const brief = proofBrief(JSON.parse(readFileSync(join(DIR, "brief.json"), "utf8")), JSON.parse(partsText));
const bytes = (file) => new Uint8Array(readFileSync(file));
const calls = [];
const gemini = {
  models: { image: "fake", imageDraft: "fake", segment: "fake" },
  generateImage: async () => (calls.push("portrait"), { mimeType: "image/png", data: bytes(join(DIR, "portrait.png")) }),
  editImage: async (_image, prompt) => (calls.push(`fill: ${prompt}`), { mimeType: "image/jpeg", data: bytes(join(DIR, "fill.jpg")) }),
  generateJson: async (prompt) => {
    if (prompt !== forge.partsPromptFromBrief(brief)) throw new Error("the parts step did not ask partsPromptFromBrief");
    calls.push("parts");
    return partsText;
  },
};
const store = new jobstore.MemoryJobStore();
let clock = 0;
const ctx = { gemini, store, charge: async () => true, now: () => (clock += 100) };
let job = { jobId: "proof0123456789abcdef", plane: "live", mode: "brief", status: "queued", createdAt: 0, brief };
job = await steps.startJob(job, undefined, ctx);
for (let i = 0; i < 8 && job.status !== "done" && job.status !== "failed"; i++) job = await steps.runStep(job, ctx);
if (job.status !== "done") throw new Error(`${slug}: live job ${job.status}: ${job.error?.message}`);

const replayJob = JSON.parse(readFileSync(join(REPLAY, "job.json"), "utf8"));
const strip = (rig) => ({ ...rig, id: "", name: "" });
const sameRig = JSON.stringify(strip(job.rig)) === JSON.stringify(strip(replayJob.rig));
const liveFiles = Object.fromEntries(
  await Promise.all(Object.entries(job.assets).map(async ([file, url]) => [file, await store.readImage(url)])),
);
const replayFiles = Object.fromEntries(replayJob.rig.layers.map((l) => [l.file, bytes(join(REPLAY, l.file))]));
const live = imagesOf(forge, liveFiles);
const replay = imagesOf(forge, replayFiles);
let maxDiff = 0;
for (const [file, img] of Object.entries(replay)) {
  const other = live[file];
  if (other === undefined || other.width !== img.width || other.height !== img.height) {
    maxDiff = 255;
    continue;
  }
  for (let i = 0; i < img.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(img.data[i] - other.data[i]));
}

const posed = (rig, images, drive) => {
  const look = { palette: rig.palette, hidden: [], emotion: "neutral" };
  const poses = rigCore.poseLayers(rig, look, { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, still: true, ...drive });
  const byName = new Map(rig.layers.map((l) => [l.name, l]));
  const offsets = {};
  const gains = {};
  const turns = {};
  for (const p of poses) {
    const layer = byName.get(p.name);
    offsets[p.name] = [p.x - layer.bbox[0], p.y - layer.bbox[1]];
    gains[p.name] = p.tint;
    turns[p.name] = { rotation: p.rotation, scale: p.scale };
  }
  return forge.compositeRig(rig, images, { offsets, gains, turns });
};
const drives = [["rest", {}], ["jaw open", { jawOpen: 1 }], ["yaw -15", { headYaw: -15 }], ["motion t=1.7", { t: 1.7, still: false }]];
const label = (img, words) => {
  const out = { width: img.width, height: img.height, data: img.data.slice() };
  text(out, words, 12, 12, [255, 255, 255], 4);
  return out;
};
const rows = [[], [], []];
for (const [name, drive] of drives) {
  const a = posed(replayJob.rig, replay, drive);
  const b = posed(job.rig, live, drive);
  const d = { width: a.width, height: a.height, data: a.data.map((v, i) => (i % 4 === 3 ? 255 : Math.min(255, 16 * Math.abs(v - b.data[i])))) };
  rows[0].push(label(a, `replay ${name}`));
  rows[1].push(label(b, `live ${name}`));
  rows[2].push(label(d, `diff x16 ${name}`));
}
const strips = rows.map(sideBySide);
const sheet = { width: strips[0].width, height: strips[0].height * 3, data: new Uint8ClampedArray(strips.flatMap((s) => [...s.data])) };
mkdirSync(join("var", "cast-forge"), { recursive: true });
const out = join("var", "cast-forge", `task11-${slug}.png`);
writeFileSync(out, forge.encodePng(sheet));
console.log(`live-proof: ${slug}: decomposition ${job.decomposition}, fill ${job.fill}, ${job.rig.layers.length} layers; rig ${sameRig ? "identical" : "DIFFERENT"} to the replay rig (id and name aside); layer pixels max diff ${maxDiff}/255; calls: ${calls.length}`);
console.log(calls.filter((c) => c.startsWith("fill")).join("\n"));
console.log(`review ${out}`);
if (!sameRig || maxDiff > 0) process.exitCode = 1;
