// Builds one cast character's replay job OFFLINE (cast-forge requirement 3.2, task 2.2):
//   node scripts/cast-forge.mjs <slug>
// Reads assets/characters/cast/<slug>/{portrait.png, parts.json (PartsV2), fill.jpg|fill.png?,
// brief.json} and runs the real pipeline (scripts/forge-lib.mjs: plateNamed with
// the fill edit, or the pure fallback; cutNamed; assembleRig). No network, no key.
// Writes assets/replay/forge/<slug>/ (job.json + portrait + layer PNGs, the presets' shape,
// `fictional: true`) and two review images:
// - var/cast-forge/<slug>.png: portrait | rest | jaw open | head turned left | head turned right |
//   motion at t = 0 | motion at t = 1.7 s | |t0 - t1.7| x4 (what moves), a 4 x 2 grid; and each pose
//   alone as var/cast-forge/<slug>-{rest,jaw,left,right,t0,t1,blink}.png (blink: the driver's, shut). Poses come
//   from @sr/rig `poseLayers` (translation, rotation and scale about the anchor, pulse tint).
// - var/cast-forge/<slug>-parts.png: the parts' polygons over the portrait, labelled.
// Fails when a named part comes out with no layer (requirement 3.3: every part its own layer).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resize } from "./cast/measure.mjs";
import { partsOverlay, text } from "./cast/overlay.mjs";
import { imagesOf, loadPipeline, readImage, runPipeline, sideBySide, stepsOf, writeReplayJob } from "./forge-lib.mjs";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("usage: node scripts/cast-forge.mjs <slug>");
const DIR = join("assets", "characters", "cast", slug);
const REVIEW = join("var", "cast-forge");
/** Head yaw for the turned panels, degrees (YAW_LIMIT_DEG is 22). */
const TURN_DEG = 15;
const MOTION_T = 1.7;

const pipeline = await loadPipeline();
const { forge, rigCore } = pipeline;

const brief = JSON.parse(readFileSync(join(DIR, "brief.json"), "utf8"));
const portraitBytes = new Uint8Array(readFileSync(join(DIR, "portrait.png")));
const portrait = readImage(forge, join(DIR, "portrait.png"));
const parsed = forge.parseParts(JSON.parse(readFileSync(join(DIR, "parts.json"), "utf8")));
if (!parsed.ok) throw new Error(`cast-forge: ${slug}: parts.json: ${parsed.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
const named = parsed.value.named;
if (named === undefined) throw new Error(`cast-forge: ${slug}: parts.json must be a v2 named-parts file`);
const fillFile = ["fill.jpg", "fill.png"].map((f) => join(DIR, f)).find((f) => existsSync(f));
const edit = fillFile === undefined ? undefined : resize(readImage(forge, fillFile), portrait.width, portrait.height);

const { cut, assembled, cutMs } = runPipeline(pipeline, { portrait, named, style: parsed.value.cut, edit, id: `replay-${slug}`, name: brief.name });
if (cut.empty.length > 0) throw new Error(`cast-forge: ${slug}: parts with no layer: ${cut.empty.join(", ")}`);

const timings = { cutMs };
const total = writeReplayJob(forge, slug, portraitBytes, assembled.files, {
  slug,
  name: brief.name,
  source: `cast-forge offline build: ${brief.provenance?.tool ?? "Codex CLI image generation"} portrait (${brief.provenance?.source ?? "cast contest"}, ${brief.provenance?.date ?? "2026-11-02"}); named parts measured from pixels; fill ${edit === undefined ? "pure fallback" : "Codex CLI image edit"}`,
  prompt: brief.one_line_request,
  fill: edit === undefined ? "fallback" : "edit",
  timings,
  steps: stepsOf(timings),
  warnings: assembled.warnings.map((w) => w.code),
  rig: assembled.rig,
});

// Review sheet.
const { rig, files } = assembled;
const images = imagesOf(forge, files);
const look = { palette: rig.palette, hidden: [], emotion: "neutral" };
const posed = (drive) => {
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
const t0 = posed({ t: 0, still: false });
const t1 = posed({ t: MOTION_T, still: false });
const diff = { width: t0.width, height: t0.height, data: t0.data.map((v, i) => (i % 4 === 3 ? 255 : Math.min(255, 4 * Math.abs(v - t1.data[i])))) };
const panels = [
  ["portrait", portrait],
  ["rest", posed({})],
  ["jaw open", posed({ jawOpen: 1 })],
  [`yaw -${TURN_DEG}`, posed({ headYaw: -TURN_DEG })],
  [`yaw ${TURN_DEG}`, posed({ headYaw: TURN_DEG })],
  ["motion t=0", t0],
  [`motion t=${MOTION_T}`, t1],
  ["t0 - t1.7 x4", diff],
].map(([label, img]) => {
  const out = { width: img.width, height: img.height, data: img.data.slice() };
  text(out, label, 12, 12, [255, 255, 255], 4);
  return out;
});
const top = sideBySide(panels.slice(0, 4));
const bottom = sideBySide(panels.slice(4));
const sheet = { width: top.width, height: top.height * 2, data: new Uint8ClampedArray([...top.data, ...bottom.data]) };
mkdirSync(REVIEW, { recursive: true });
writeFileSync(join(REVIEW, `${slug}.png`), forge.encodePng(sheet));
writeFileSync(join(REVIEW, `${slug}-parts.png`), forge.encodePng(partsOverlay(portrait, named)));
// The driver's blink is not a sheet panel (the grid is requirement 3.2's); it gets its own PNG (task 7).
for (const [name, img] of [["rest", panels[1]], ["jaw", panels[2]], ["left", panels[3]], ["right", panels[4]], ["t0", t0], ["t1", t1], ["blink", posed({ blink: 1 })]]) {
  writeFileSync(join(REVIEW, `${slug}-${name}.png`), forge.encodePng(img));
}
const moving = rig.layers.filter((l) => l.motion !== undefined).map((l) => l.name);
console.log(`cast-forge: ${slug}: ${rig.layers.length} layers (${moving.length} with motion: ${moving.join(", ")}), cut ${cutMs} ms, ${(total / 1024).toFixed(0)} KB; review ${join(REVIEW, `${slug}.png`)}`);
