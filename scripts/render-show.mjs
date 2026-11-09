// Renders a recorded show's lines to WAV with Gemini TTS (voice-and-air task 4.2). Owner tool, paid:
// never run by tests or CI. The key is read from GEMINI_API_KEY and only ever sent in the
// `x-goog-api-key` header; it is never printed or written.
//
//   node scripts/render-show.mjs [--show malakor-night] [--voice clerk] [--force] [--dry-run]
//
// Writes assets/replay/shows/<show>/<beat>.wav (16-bit mono PCM, the rate Gemini answers with,
// 24 kHz). Lines whose WAV already exists are skipped unless --force, so a re-run pays only for
// what is missing. The model is SR_TTS_MODEL, else the newest Flash TTS model the key can list.
// The voice map is read from the source the live plane uses (packages/engine/src/voices.ts), and
// like api/_lib/tts.ts the script sends the line alone: a style prefix gets read aloud.
// A reply that is already WAV (mime audio/wav) is kept as is; raw PCM (audio/L16) gets a header.
// Since perfection-pass 10.3 the show files name `.m4a` clips: the WAV is encoded to AAC by
// scripts/voice-m4a.mjs (ffmpeg on PATH or $FFMPEG) before it is written; a beat naming `.wav`
// still gets the WAV. The summary's seconds count only WAVs.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toM4a } from "./voice-m4a.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://generativelanguage.googleapis.com/v1beta";
const SIZE_BUDGET = 15 * 1024 * 1024;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const showId = arg("show", "malakor-night");
const voiceId = arg("voice", "clerk");
const force = flag("force");
const dryRun = flag("dry-run");

const SHOWS = join(ROOT, "assets", "replay", "shows");
const show = JSON.parse(readFileSync(join(SHOWS, `${showId}.json`), "utf8"));

const voicesSrc = readFileSync(join(ROOT, "packages", "engine", "src", "voices.ts"), "utf8");
const voiceMatch = new RegExp(`\\b${voiceId}:\\s*\\{\\s*gemini:\\s*"([^"]+)"`).exec(voicesSrc);
if (!voiceMatch) throw new Error(`voice ${voiceId} not found in voices.ts`);
const geminiVoice = voiceMatch[1];

const pending = show.beats.filter((b) => force || !existsSync(join(SHOWS, b.wav)));
console.log(`render-show: ${showId}, ${show.beats.length} lines, ${pending.length} to render, voice ${voiceId} (${geminiVoice})`);
if (dryRun) {
  for (const b of pending) console.log(`  ${b.wav}  ${b.reply.line.length} chars`);
  process.exit(0);
}

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error("render-show: GEMINI_API_KEY is not set");
  process.exit(1);
}
const headers = { "content-type": "application/json", "x-goog-api-key": key };

/** The newest Flash TTS model this key can call (names like models/gemini-2.5-flash-preview-tts). */
async function pickModel() {
  const fromEnv = process.env.SR_TTS_MODEL?.trim();
  if (fromEnv) return fromEnv;
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`model list failed: HTTP ${res.status}`);
  const { models = [] } = await res.json();
  const tts = models
    .filter((m) => /tts/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  console.log(`render-show: TTS models available: ${tts.join(", ") || "(none)"}`);
  const version = (name) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);
  const ranked = tts.sort((a, b) => version(b) - version(a) || Number(/flash/.test(b)) - Number(/flash/.test(a)) || a.length - b.length);
  const flash = ranked.find((n) => /flash/.test(n));
  if (!flash && !ranked[0]) throw new Error("no TTS model available to this key");
  return flash ?? ranked[0];
}

function wav(pcm, rate) {
  const data = pcm.length - (pcm.length % 2);
  const out = Buffer.alloc(44 + data);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + data, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(data, 40);
  pcm.copy(out, 44, 0, data);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function speak(model, text) {
  const body = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
    },
  };
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) {
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error(`no audio in reply (finishReason ${json.candidates?.[0]?.finishReason ?? "?"})`);
      const bytes = Buffer.from(part.inlineData.data, "base64");
      const isWav = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
      const rate = isWav ? bytes.readUInt32LE(24) : Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24_000);
      return { bytes, isWav, rate, mime: part.inlineData.mimeType };
    }
    await res.body?.cancel();
    // Rate limits and transient 5xx inside this one run: wait and try the same line again.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 15_000 * attempt;
      console.log(`  HTTP ${res.status}, waiting ${wait / 1000} s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

const model = await pickModel();
console.log(`render-show: model ${model}`);
let failures = 0;
for (const beat of pending) {
  const out = join(SHOWS, beat.wav);
  mkdirSync(dirname(out), { recursive: true });
  const started = Date.now();
  try {
    const { bytes, isWav, rate, mime } = await speak(model, beat.reply.line);
    const clip = isWav ? bytes : wav(bytes, rate);
    writeFileSync(out, out.endsWith(".m4a") ? toM4a(clip, beat.wav) : clip);
    const seconds = (bytes.length - (isWav ? 44 : 0)) / 2 / rate;
    console.log(`  ${beat.wav}  ${seconds.toFixed(1)} s  ${rate} Hz  ${mime}  ${Date.now() - started} ms`);
  } catch (err) {
    failures += 1;
    console.log(`  ${beat.wav}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let total = 0;
let seconds = 0;
let present = 0;
for (const beat of show.beats) {
  const path = join(SHOWS, beat.wav);
  if (!existsSync(path)) continue;
  present += 1;
  const size = statSync(path).size;
  total += size;
  if (path.endsWith(".wav")) seconds += Math.max(0, size - 44) / 2 / 24_000;
}
console.log(`render-show: ${present}/${show.beats.length} clips,${(total / 1024 / 1024).toFixed(2)} MB, ~${seconds.toFixed(0)} s, ${failures} failed`);
if (total > SIZE_BUDGET) console.log("render-show: OVER the 15 MB budget - do not commit; re-render at a lower rate");
process.exit(failures > 0 ? 1 : 0);
