// Builds the replay plane's pre-forged jobs (forge-pipeline task 8, requirement 7.5) OFFLINE:
//   node scripts/forge-replay.mjs
// No network, no key, no paid call. Each job runs the real pipeline (@sr/forge cutAll +
// assembleRig, the server's blurExtend fallback plate) on a portrait and a recorded parts reply that
// already exist: the committed Malakor portrait with the recorded m8 parts, and the three 2026-11-01
// spike portraits (Gemini 3 Pro Image; committed under assets/replay/forge/<slug>/portrait.jpg, first
// taken from var/forge-spike/<slug>/) with their recorded parts.
// Output: assets/replay/forge/<slug>/{job.json, portrait.*, <layer>.png}. The fill is "fallback"
// (no Gemini edit was made). Timings in job.json are the recorded upstream latencies (portrait,
// parts) and this machine's cut time; `steps` holds the replay latency per status (1.5-3 s).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";

const OUT = join("assets", "replay", "forge");
const MAX_FILE_BYTES = 1024 * 1024;

const presets = readFileSync(join("assets", "characters", "presets", "PROMPTS.md"), "utf8");
/** The `Character` text of preset n in PROMPTS.md, line breaks joined (as the spike sent it). */
function presetText(n) {
  const section = presets.split(/\n## /).find((s) => s.startsWith(`${n}. `));
  const match = section?.match(/\*\*Character[^\n]*\n((?:>.*\n?)+)/);
  if (!match) throw new Error(`forge-replay: no Character text for preset ${n}`);
  return match[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ");
}

/**
 * The portrait a job is built from: the copy already committed under assets/replay/forge (so a
 * re-run reproduces the same jobs after the spike is re-run), else the spike's output in var/.
 */
const portraitOf = (slug) => {
  const committed = join(OUT, slug, "portrait.jpg");
  return existsSync(committed) ? committed : join("var", "forge-spike", slug, "portrait.jpg");
};

const SOURCES = [
  {
    slug: "malakor",
    name: "Arch-Lich Malakor",
    prompt: "Arch-Lich Malakor", // a label: this portrait is pre-existing art, not generated from a prompt
    portrait: join("assets", "characters", "malakor", "rig", "portrait.png"),
    parts: join("packages", "forge", "test", "fixtures", "m8-parts.json"),
    recorded: { partsMs: 17312 }, // parts-only run 2026-11-01 14:18 UTC (docs/decisions/0003)
    source: "committed Malakor portrait (pre-existing art) + recorded gemini-3.8-flash parts, 2026-11-01",
  },
  // Recorded latencies of the 2026-11-01 13:15 UTC spike run (docs/decisions/0003, summary.json).
  ...[
    ["lantern-warden", "The Lantern Warden", 1, { portraitMs: 14962, partsMs: 17073 }],
    ["understudy", "The Understudy", 3, { portraitMs: 15381, partsMs: 13701 }],
    ["announcer-of-dead-air", "Announcer of Dead Air", 5, { portraitMs: 15949, partsMs: 19648 }],
  ].map(([slug, name, preset, recorded]) => ({
    slug,
    name,
    prompt: presetText(preset),
    portrait: portraitOf(slug),
    parts: join("packages", "forge", "test", "fixtures", `spike-${slug}-parts.json`),
    recorded,
    source: `forge spike 2026-11-01: gemini-3-pro-image portrait (preset ${preset}) + recorded gemini-3.8-flash parts`,
  })),
];

const { module: forge } = await runnerImport("/packages/forge/src/index.ts");
const { module: steps } = await runnerImport("/api/_lib/forge-steps.ts");

/** Replay latency per status, 1.5-3 s (requirement 7.5), scaled from the recorded step it stands for. */
const hold = (ms) => Math.round(Math.min(3000, Math.max(1500, (ms ?? 0) / 8)));

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

  const started = performance.now();
  const plate = steps.fallbackPlate(portrait, forge.FILL_PARTS.flatMap((n) => parts.find((p) => p.name === n) ?? []));
  const cut = forge.cutAll(portrait, parts, { plate });
  const assembled = forge.assembleRig(parts, cut.layers, { id: `replay-${src.slug}`, name: src.name, portrait, plate });
  const cutMs = Math.round(performance.now() - started);
  if (!assembled.ok) throw new Error(`forge-replay: ${src.slug}: rig invalid: ${assembled.errors.map((e) => e.code).join(", ")}`);

  const dir = join(OUT, src.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const portraitFile = `portrait.${forge.sniffImage(bytes) === "png" ? "png" : "jpg"}`;
  writeFileSync(join(dir, portraitFile), bytes); // from memory: the source may be the file just removed
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
    fill: "fallback",
    timings,
    steps: [
      { status: "queued", holdMs: 1500 },
      { status: "portrait", holdMs: hold(timings.portraitMs) },
      { status: "segmenting", holdMs: hold(timings.partsMs) },
      { status: "cutting", holdMs: hold(cutMs) },
      { status: "filling", holdMs: 1500 },
      { status: "done" },
    ],
    warnings: assembled.value.warnings.map((w) => w.code),
    rig: assembled.value.rig,
  };
  writeFileSync(join(dir, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  index.push(src.slug);
  console.log(`forge-replay: ${src.slug}: ${job.rig.layers.length} layers, ${cut.empty.length} empty part(s), cut ${cutMs} ms, ${(total / 1024).toFixed(0)} KB`);
}
console.log(`forge-replay: wrote ${index.length} jobs under ${OUT}`);
