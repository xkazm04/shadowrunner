// Recorded show voices as AAC in MP4 (`.m4a`; perfection-pass requirement 10.3).
//
//   node scripts/voice-m4a.mjs <dir> [--json a.json,b.json] [--keep b00.wav] [--dry]
//
// Why AAC: every evergreen browser decodes it in <audio> and in AudioContext.decodeAudioData
// (Safari natively: AAC is its own format). Measured with decodeAudioData in Chromium and Firefox
// on all 24 clips: exactly the WAV's frame count, 0 ms lag (ffmpeg writes an edit list over the
// encoder priming, which both honour), 28.7-35.6 dB waveform SNR at 96 kbps mono. Opus/WebM came
// out 12 frames short in Chromium, and Safari's Web Audio took Opus much later than AAC.
// `bitexact` keeps the output free of encoder version and timestamps: same input, same bytes.
//
// Every `*.wav` directly in <dir> becomes a sibling `.m4a` and the WAV is deleted, except the
// `--keep` names (a test reads malakor-night/b00.wav as 16-bit PCM; it is not shipped: the bundle
// globs `.m4a` and scripts/vercel-output.mjs skips WAVs); each `--json` file (a path relative to
// the repository root) has its quoted `"<show>/<name>.wav"` strings for the converted files
// rewritten in place (text replace: formatting and key order untouched).
// scripts/render-show.mjs encodes new lines through `toM4a` with the same settings.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

/** ffmpeg: $FFMPEG, else the one on PATH. */
export const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

/** 96 kbps mono AAC-LC in a plain (unfragmented) MP4 with the index first, no metadata. */
export const M4A_ARGS = ["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-movflags", "+faststart"];

/** WAV bytes -> .m4a bytes (through temp files: the MP4 muxer needs a seekable output). Throws unless the result is an MP4. */
export function toM4a(wav, label = "voice") {
  const tmp = mkdtempSync(join(tmpdir(), "sr-voice-"));
  try {
    writeFileSync(join(tmp, "in.wav"), wav);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", join(tmp, "in.wav"), ...M4A_ARGS, join(tmp, "out.m4a")]);
    const out = readFileSync(join(tmp, "out.m4a"));
    if (out.length < 1024 || out.subarray(4, 8).toString("latin1") !== "ftyp") throw new Error(`${label}: ffmpeg did not write an MP4`);
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const [dir, ...rest] = argv;
  if (dir === undefined) throw new Error("usage: voice-m4a.mjs <dir> [--json a,b] [--keep x.wav] [--dry]");
  const opt = (name) => (rest.includes(name) ? (rest[rest.indexOf(name) + 1] ?? "").split(",").filter(Boolean) : []);
  const json = opt("--json");
  const keep = new Set(opt("--keep"));
  const dry = rest.includes("--dry");
  const show = basename(resolve(dir));
  // A kept WAV whose clip exists is done already.
  const wavs = readdirSync(dir)
    .filter((f) => f.endsWith(".wav") && !(keep.has(f) && existsSync(join(dir, f.replace(/\.wav$/, ".m4a")))))
    .sort();
  let before = 0;
  let after = 0;
  for (const file of wavs) {
    const wav = readFileSync(join(dir, file));
    const m4a = toM4a(wav, file);
    before += wav.length;
    after += m4a.length;
    if (dry) continue;
    writeFileSync(join(dir, file.replace(/\.wav$/, ".m4a")), m4a);
    if (!keep.has(file)) rmSync(join(dir, file));
    console.log(`${file}: ${wav.length} -> ${m4a.length}`);
  }
  if (!dry) {
    for (const path of json) {
      let text = readFileSync(path, "utf8");
      for (const file of wavs) text = text.split(`"${show}/${file}"`).join(`"${show}/${file.replace(/\.wav$/, ".m4a")}"`);
      writeFileSync(path, text);
    }
  }
  console.log(`${wavs.length} files, ${before} -> ${after} bytes (${before === 0 ? 0 : ((after / before) * 100).toFixed(1)}%)`);
}

if (process.argv[1]?.endsWith("voice-m4a.mjs")) main(process.argv.slice(2));
