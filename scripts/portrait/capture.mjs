// Morph capture (companion-lanes task 1, D; requirement 6.1): renders apps/web/bench/morph.html at a
// list of states through the real WebGL player in headless Chromium and writes one PNG (with alpha)
// per state; `--board` tiles them with labels; `--proof` renders the synthetic rig's proof states
// and prints the shader's pixel checks (scripts/portrait/proof.mjs).
//
//   node scripts/portrait/capture.mjs --out <dir> [--pack <url>] [--state <name>=<query>]...
//        [--states <file.json>] [--board] [--proof] [--port 5311] [--size 512] [--headed]
//
// `<query>` is morph.html's query (t, blink, gx, gy, yaw, pitch, emotion, shapes, level, sway, key, bg,
// size, mode); `--pack` adds pack=<url> to each. `--states` is a JSON object { name: query } or an
// array of [name, query]. The page is served by this script's own Vite dev server on `--port`
// (default 5311, strict, HMR and file watching off) from apps/web, closed at the end. Chromium is
// Playwright's (apps/web's @playwright/test), the full browser in new-headless mode with the GPU
// flags the lab uses (apps/lab/src/director/stage/browser.ts); the page reports the GPU it got.
/* global document, window -- the callbacks handed to page.waitForFunction and page.evaluate run in the page */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");
const GPU_FLAGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=default", "--enable-unsafe-swiftshader"];

function args(argv) {
  const out = { states: [], port: 5311, size: 512, board: false, proof: false, headed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--out") out.out = next();
    else if (a === "--pack") out.pack = next();
    else if (a === "--port") out.port = Number(next());
    else if (a === "--size") out.size = Number(next());
    else if (a === "--board") out.board = true;
    else if (a === "--proof") out.proof = true;
    else if (a === "--headed") out.headed = true;
    else if (a === "--state") {
      const [name, ...rest] = next().split("=");
      out.states.push([name, rest.join("=")]);
    } else if (a === "--states") {
      const parsed = JSON.parse(readFileSync(next(), "utf8"));
      out.states.push(...(Array.isArray(parsed) ? parsed : Object.entries(parsed)));
    } else throw new Error(`capture: unknown argument ${a}`);
  }
  return out;
}

/** A Vite dev server for apps/web on `port`, without HMR or a file watcher. */
async function serve(port) {
  const server = await createServer({
    configFile: join(WEB, "vite.config.ts"),
    root: WEB,
    logLevel: "warn",
    server: { port, strictPort: true, hmr: false, watch: null },
    // Pre-bundle from the capture page alone (the app's index.html wants the built theme).
    optimizeDeps: { entries: ["bench/morph.html"] },
  });
  await server.listen();
  return server;
}

/** Opens Chromium; `shoot(query)` renders one state and returns { png: Buffer, info }. */
export async function openCapture({ port = 5311, headed = false } = {}) {
  const server = await serve(port);
  const { chromium } = createRequire(join(WEB, "package.json"))("@playwright/test");
  const browser = await chromium.launch({ headless: !headed, channel: "chromium", args: GPU_FLAGS });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shoot = async (query) => {
    await page.goto(`http://localhost:${port}/bench/morph.html?${query}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready !== undefined, undefined, { timeout: 120_000 });
    const state = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, error: window.morphError, info: window.morphInfo, png: window.morphPng?.() }));
    if (state.ready !== "1" || state.png === undefined) throw new Error(`capture ${query}: ${state.error ?? errors.join("; ") ?? "no frame"}`);
    return { png: Buffer.from(state.png.slice(state.png.indexOf(",") + 1), "base64"), info: state.info };
  };
  const close = async () => {
    await browser.close();
    await server.close();
  };
  return { shoot, close };
}

const escape = (text) => text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/** Tiles PNGs (each scaled to `tile` px) in a grid, a label under each, on a mid grey. */
export async function board(shots, file, tile = 256) {
  const cols = Math.ceil(Math.sqrt(shots.length));
  const rows = Math.ceil(shots.length / cols);
  const label = 22;
  const layers = await Promise.all(
    shots.map(async ([name, png], i) => {
      const x = (i % cols) * tile;
      const y = Math.floor(i / cols) * (tile + label);
      const image = await sharp(png).resize(tile, tile, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const text = Buffer.from(`<svg width="${tile}" height="${label}"><text x="6" y="16" font-family="monospace" font-size="13" fill="white">${escape(name)}</text></svg>`);
      return [{ input: image, left: x, top: y }, { input: text, left: x, top: y + tile }];
    }),
  );
  await sharp({ create: { width: cols * tile, height: rows * (tile + label), channels: 4, background: { r: 64, g: 64, b: 72, alpha: 1 } } })
    .composite(layers.flat())
    .png()
    .toFile(file);
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.proof) {
    const { runProof } = await import("./proof.mjs");
    await runProof({ ...opts, open: openCapture, board });
    return;
  }
  if (opts.out === undefined || opts.states.length === 0) throw new Error("capture: --out <dir> and at least one --state or --states are required");
  mkdirSync(opts.out, { recursive: true });
  const capture = await openCapture(opts);
  const shots = [];
  try {
    for (const [name, query] of opts.states) {
      const q = [query, opts.pack === undefined ? "" : `pack=${encodeURIComponent(opts.pack)}`, query.includes("size=") ? "" : `size=${opts.size}`].filter((s) => s !== "").join("&");
      const { png, info } = await capture.shoot(q);
      writeFileSync(join(opts.out, `${name}.png`), png);
      shots.push([name, png]);
      console.log(`${name}: ${info.mode} on ${info.gpu}; keys ${info.keys.map((k) => `${k.id}:${k.weight.toFixed(3)}${k.colour === 1 ? "" : `/c${k.colour.toFixed(2)}`}`).join(" ") || "none"}${info.sway === null ? "" : `; sway ${info.sway.x},${info.sway.y}`}`);
    }
    if (opts.board) await board(shots, join(opts.out, "board.png"));
  } finally {
    await capture.close();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
