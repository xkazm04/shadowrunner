// Timeline capture (talking-head task 3): steps apps/web/bench/timeline.html (the real avatar player,
// stepped by hand at 30 fps) frame by frame in headless Chromium, pipes every frame's PNG into
// ffmpeg (H.264, 30 fps, yuv420p) and muxes the wav. Same input, same frames: the player is seeded
// and stepped by a fixed dt, never by the wall clock (`--hashes` writes each frame's RGBA sha256).
//
//   node scripts/portrait/timeline-capture.mjs --out <mp4> (--timeline <json> | --audio <wav>)
//        [--audio <wav>] [--text <txt>] [--mouth-rest] [--pack <url>] [--size 1024] [--seed 1]
//        [--frames N] [--keep 0,75,150 --keep-dir <dir>] [--hashes <file>] [--port 5312] [--headed]
//
// - `--timeline`: a th-timeline/1 (tools/talking-head/th/rig/timeline.py) drives the face;
//   `--audio` alone: the studio's own lip-sync from the wav and `--text` (the spoken words);
//   `--mouth-rest` with `--audio`: the rest mouth, everything else live (the dub-ls plate).
// - The wav also drives the player's speech level and is muxed as AAC; without it the video is silent.
// - `--frames` caps the frame count (look runs); `--keep` writes those frames' PNGs to `--keep-dir`.
// - The page is served by this script's own Vite dev server on `--port` (default 5312, strict, HMR
//   and file watching off); the input files reach it through Playwright routes under /th-input/.
//   Server and browser are closed at the end, also on a failure.
/* global document, window -- the callbacks handed to page.waitForFunction and page.evaluate run in the page */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");
const GPU_FLAGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=default", "--enable-unsafe-swiftshader"];
const TYPES = { ".json": "application/json", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8" };

export function parseArgs(argv) {
  const out = { port: 5312, size: 1024, seed: 1, headed: false, mouthRest: false, keep: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`timeline-capture: ${a} needs a value`);
      return v;
    };
    if (a === "--out") out.out = next();
    else if (a === "--timeline") out.timeline = next();
    else if (a === "--audio") out.audio = next();
    else if (a === "--text") out.text = next();
    else if (a === "--pack") out.pack = next();
    else if (a === "--size") out.size = Number(next());
    else if (a === "--seed") out.seed = Number(next());
    else if (a === "--frames") out.frames = Number(next());
    else if (a === "--port") out.port = Number(next());
    else if (a === "--keep") out.keep = next().split(",").map(Number);
    else if (a === "--keep-dir") out.keepDir = next();
    else if (a === "--hashes") out.hashes = next();
    else if (a === "--mouth-rest") out.mouthRest = true;
    else if (a === "--headed") out.headed = true;
    else throw new Error(`timeline-capture: unknown argument ${a}`);
  }
  if (out.out === undefined) throw new Error("timeline-capture: --out <mp4> is required");
  if (out.timeline === undefined && out.audio === undefined) throw new Error("timeline-capture: --timeline <json> or --audio <wav> is required");
  if (out.keep.length > 0 && out.keepDir === undefined) throw new Error("timeline-capture: --keep needs --keep-dir");
  return out;
}

/** timeline.html's query for these options; input files are named under /th-input/. */
export function pageQuery(opts) {
  const q = new URLSearchParams({ size: String(opts.size), seed: String(opts.seed) });
  if (opts.pack !== undefined) q.set("pack", opts.pack);
  if (opts.timeline !== undefined) q.set("timeline", `/th-input/timeline${extOf(opts.timeline)}`);
  if (opts.audio !== undefined) q.set("audio", "/th-input/audio.wav");
  if (opts.text !== undefined) q.set("text", "/th-input/text.txt");
  if (opts.mouthRest) q.set("mouth", "rest");
  return q.toString();
}

const extOf = (file) => (basename(file).includes(".") ? basename(file).slice(basename(file).lastIndexOf(".")) : "");

async function serve(port) {
  const server = await createServer({
    configFile: join(WEB, "vite.config.ts"),
    root: WEB,
    logLevel: "warn",
    server: { port, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { entries: ["bench/timeline.html"] },
  });
  await server.listen();
  return server;
}

/** ffmpeg reading PNGs on stdin at 30 fps (+ the wav), writing H.264 to `out`. */
function encoder(out, audio) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", "pipe:0"];
  if (audio !== undefined) args.push("-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k");
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", ...(audio === undefined ? [] : ["-shortest"]), out);
  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += String(d)));
  const done = new Promise((ok, fail) => {
    proc.on("error", fail);
    proc.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-600)}`))));
  });
  const write = (buf) => (proc.stdin.write(buf) ? Promise.resolve() : new Promise((ok) => proc.stdin.once("drain", ok)));
  return { write, end: () => (proc.stdin.end(), done), kill: () => proc.kill() };
}

export async function captureTimeline(opts) {
  const server = await serve(opts.port);
  const { chromium } = createRequire(join(WEB, "package.json"))("@playwright/test");
  const browser = await chromium.launch({ headless: !opts.headed, channel: "chromium", args: GPU_FLAGS }).catch(async (e) => {
    await server.close();
    throw e;
  });
  let enc;
  try {
    const page = await (await browser.newContext({ viewport: { width: opts.size, height: opts.size }, deviceScaleFactor: 1 })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const inputs = { [`timeline${opts.timeline === undefined ? "" : extOf(opts.timeline)}`]: opts.timeline, "audio.wav": opts.audio, "text.txt": opts.text };
    await page.route("**/th-input/*", (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
      const file = inputs[name];
      if (file === undefined) return route.fulfill({ status: 404, body: `no input ${name}` });
      return route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extOf(file)] ?? "application/octet-stream" });
    });
    await page.goto(`http://localhost:${opts.port}/bench/timeline.html?${pageQuery(opts)}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready !== undefined, undefined, { timeout: 180_000 });
    const state = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, error: window.timelineError, info: window.timelineInfo }));
    if (state.ready !== "1") throw new Error(`timeline page: ${state.error ?? errors.join("; ")}`);
    const info = state.info;
    const total = opts.frames === undefined ? info.frames : Math.min(info.frames, opts.frames);
    console.log(`timeline-capture: ${total} frames at ${info.fps} fps, ${opts.size}px, ${info.source}, on ${info.gpu}`);
    if (opts.keepDir !== undefined) mkdirSync(opts.keepDir, { recursive: true });
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    // The wav is muxed and cut to the picture (-shortest): the picture is the clip.
    enc = encoder(resolve(opts.out), opts.audio === undefined ? undefined : resolve(opts.audio));
    const hashes = [];
    const t0 = performance.now();
    for (let i = 0; i < total; i += 1) {
      const url = await page.evaluate((n) => window.renderFrame(n), i);
      const png = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      await enc.write(png);
      if (opts.hashes !== undefined) hashes.push(createHash("sha256").update(await sharp(png).ensureAlpha().raw().toBuffer()).digest("hex"));
      if (opts.keep.includes(i)) writeFileSync(join(opts.keepDir, `frame-${String(i).padStart(5, "0")}.png`), png);
      if (i % 150 === 0 || i === total - 1) console.log(`timeline-capture: frame ${i + 1}/${total} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    }
    await enc.end();
    enc = undefined;
    if (opts.hashes !== undefined) writeFileSync(opts.hashes, hashes.join("\n") + "\n");
    if (errors.length > 0) console.warn(`timeline-capture: page errors: ${errors.join("; ")}`);
    return { frames: total, info, seconds: (performance.now() - t0) / 1000 };
  } finally {
    enc?.kill();
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureTimeline(parseArgs(process.argv.slice(2)))
    .then((r) => console.log(`timeline-capture: ${r.frames} frames in ${r.seconds.toFixed(1)}s`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
