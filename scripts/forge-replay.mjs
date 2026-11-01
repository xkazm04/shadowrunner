// Builds the replay plane's pre-forged jobs (forge-pipeline tasks 8 and 9, requirement 7.5) OFFLINE:
//   node scripts/forge-replay.mjs
// No network, no key, no paid call. Each job runs the real pipeline (the server's `plateFor` with
// @sr/forge `composePlate`, `cutAll` and `assembleRig`) on inputs that were recorded once:
// - Malakor: the committed portrait with the recorded m8 parts; no fill edit, so the pure fallback.
// - Five presets of assets/characters/presets/PROMPTS.md, each in assets/characters/presets/<slug>/:
//   `portrait.jpg` (Gemini 3 Pro Image, portraitPrompt), `parts.json` (Gemini 3.8 Flash,
//   PARTS_PROMPT, parsed) and `fill.jpg` (the Gemini 3 Pro Image fill edit). Presets 1, 3 and 5 come
//   from the forge spike run of 2026-11-01 15:58 UTC (task 1.2), presets 2 and 4 from the task 9
//   run of 2026-11-01 16:25 UTC (docs/decisions/0003-forge-spike.md).
// Output: assets/replay/forge/<slug>/{job.json, portrait.*, <layer>.png}. The images are served as
// static files at /replay/forge/<slug>/ (task 9); job.json is bundled into the forge function.
// Timings in job.json are the recorded upstream latencies and this machine's cut time; `steps`
// holds the replay latency per status (1.5-3 s). It also writes var/forge-replay/<slug>.png: the
// portrait, the rig at rest, with the jaw open (0.06 x height) and with the head turned, for review.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";

const OUT = join("assets", "replay", "forge");
/** Per file. The background is the whole plate as a lossless PNG since task 9 (about 0.7-1.5 MB). */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
const PRESETS = join("assets", "characters", "presets");
const REVIEW = join("var", "forge-replay");

const presets = readFileSync(join("assets", "characters", "presets", "PROMPTS.md"), "utf8");
/** The `Character` text of preset n in PROMPTS.md, line breaks joined (as the spike sent it). */
function presetText(n) {
  const section = presets.split(/\n## /).find((s) => s.startsWith(`${n}. `));
  const match = section?.match(/\*\*Character[^\n]*\n((?:>.*\n?)+)/);
  if (!match) throw new Error(`forge-replay: no Character text for preset ${n}`);
  return match[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ");
}

const SOURCES = [
  {
    slug: "malakor",
    name: "Arch-Lich Malakor",
    prompt: "Arch-Lich Malakor", // a label: this portrait is pre-existing art, not generated from a prompt
    portrait: join("assets", "characters", "malakor", "rig", "portrait.png"),
    parts: join("packages", "forge", "test", "fixtures", "m8-parts.json"),
    recorded: { partsMs: 17312 }, // parts-only run 2026-11-01 14:18 UTC (docs/decisions/0003)
    source: "committed Malakor portrait (pre-existing art) + recorded gemini-3.8-flash parts, 2026-11-01; pure fill fallback",
  },
  // Recorded latencies (the server's own `timings`) of the runs named above.
  ...[
    ["lantern-warden", "The Lantern Warden", 1, { portraitMs: 17302, partsMs: 17928, fillMs: 16696 }, "15:58"],
    ["sister-vesper", "Sister Vesper", 2, { portraitMs: 15106, partsMs: 19759, fillMs: 17846 }, "16:25"],
    ["understudy", "The Understudy", 3, { portraitMs: 18018, partsMs: 11745, fillMs: 18112 }, "15:58"],
    ["moth-widow", "The Moth Widow", 4, { portraitMs: 15154, partsMs: 21532, fillMs: 15238 }, "16:25"],
    ["announcer-of-dead-air", "Announcer of Dead Air", 5, { portraitMs: 16279, partsMs: 11914, fillMs: 15831 }, "15:58"],
  ].map(([slug, name, preset, recorded, at]) => ({
    slug,
    name,
    prompt: presetText(preset),
    portrait: join(PRESETS, slug, "portrait.jpg"),
    parts: join(PRESETS, slug, "parts.json"),
    fill: join(PRESETS, slug, "fill.jpg"),
    recorded,
    source: `forge run 2026-11-01 ${at} UTC: gemini-3-pro-image portrait (preset ${preset}) and fill edit + recorded gemini-3.8-flash parts`,
  })),
];

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: steps } = await runnerImport("/api/_lib/forge-steps.ts");
const { module: rigCore } = await runnerImport("/packages/rig/src/index.ts");

/** Replay latency per status, 1.5-3 s (requirement 7.5), scaled from the recorded step it stands for. */
const hold = (ms) => Math.round(Math.min(3000, Math.max(1500, (ms ?? 0) / 8)));

/** var/forge-replay/<slug>.png: portrait | rest | jaw open | head turned 10 degrees with the jaw half open. */
function review(slug, portrait, { rig, files }) {
  const images = Object.fromEntries(Object.entries(files).map(([file, png]) => [file, forge.decodeImage(png).value]));
  const drop = Math.round(rigCore.JAW_DROP * rig.height);
  const turn = (10 / rigCore.YAW_LIMIT_DEG) * rigCore.YAW_SHIFT * rig.width;
  const panels = [portrait, forge.compositeRig(rig, images), forge.compositeRig(rig, images, { jaw: drop }), forge.compositeRig(rig, images, { jaw: drop / 2, parallax: turn })];
  const { width, height } = rig;
  const data = new Uint8ClampedArray(width * panels.length * height * 4);
  panels.forEach((p, k) => {
    for (let y = 0; y < height; y++) data.set(p.data.subarray(y * width * 4, (y + 1) * width * 4), (y * width * panels.length + k * width) * 4);
  });
  mkdirSync(REVIEW, { recursive: true });
  writeFileSync(join(REVIEW, `${slug}.png`), forge.encodePng({ width: width * panels.length, height, data }));
}

const index = [];
for (const src of SOURCES) {
  if (!existsSync(src.portrait)) throw new Error(`forge-replay: missing ${src.portrait}`);
  const bytes = new Uint8Array(readFileSync(src.portrait));
  const decoded = forge.decodeImage(bytes);
  if (!decoded.ok) throw new Error(`forge-replay: ${src.portrait}: ${decoded.errors.message}`);
  const portrait = decoded.value;
  const parsed = forge.parseParts(JSON.parse(readFileSync(src.parts, "utf8")));
  if (!parsed.ok) throw new Error(`forge-replay: ${src.parts} does not parse`);
  const parts = parsed.value.parts;
  let edit;
  if (src.fill !== undefined) {
    const fill = forge.decodeImage(new Uint8Array(readFileSync(src.fill)));
    if (!fill.ok) throw new Error(`forge-replay: ${src.fill}: ${fill.errors.message}`);
    edit = fill.value;
  }

  const started = performance.now();
  const plate = steps.plateFor(portrait, parts, edit);
  const cut = forge.cutAll(portrait, parts, { plate });
  const assembled = forge.assembleRig(parts, cut.layers, { id: `replay-${src.slug}`, name: src.name, portrait, plate });
  const cutMs = Math.round(performance.now() - started);
  if (!assembled.ok) throw new Error(`forge-replay: ${src.slug}: rig invalid: ${assembled.errors.map((e) => e.code).join(", ")}`);

  const dir = join(OUT, src.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const portraitFile = `portrait.${forge.sniffImage(bytes) === "png" ? "png" : "jpg"}`;
  writeFileSync(join(dir, portraitFile), bytes);
  const sizes = { [portraitFile]: bytes.length };
  for (const [file, png] of Object.entries(assembled.value.files)) {
    writeFileSync(join(dir, file), png);
    sizes[file] = png.length;
  }
  const over = Object.entries(sizes).filter(([, n]) => n > MAX_FILE_BYTES);
  if (over.length > 0) throw new Error(`forge-replay: ${src.slug}: files over 1 MB: ${over.map(([f]) => f).join(", ")}`);

  const timings = { ...src.recorded, cutMs };
  const job = {
    slug: src.slug,
    name: src.name,
    fictional: true,
    source: src.source,
    prompt: src.prompt,
    promptSha256: createHash("sha256").update(src.prompt).digest("hex"),
    portrait: portraitFile,
    fill: edit === undefined ? "fallback" : "edit",
    timings,
    steps: [
      { status: "queued", holdMs: 1500 },
      { status: "portrait", holdMs: hold(timings.portraitMs) },
      { status: "segmenting", holdMs: hold(timings.partsMs) },
      { status: "cutting", holdMs: hold(timings.fillMs) },
      { status: "filling", holdMs: hold(cutMs) },
      { status: "done" },
    ],
    warnings: assembled.value.warnings.map((w) => w.code),
    rig: assembled.value.rig,
  };
  writeFileSync(join(dir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  review(src.slug, portrait, assembled.value);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  index.push(src.slug);
  console.log(`forge-replay: ${src.slug}: ${job.rig.layers.length} layers, ${cut.empty.length} empty part(s), cut ${cutMs} ms, ${(total / 1024).toFixed(0)} KB`);
}
console.log(`forge-replay: wrote ${index.length} jobs under ${OUT}`);
