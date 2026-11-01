// Forge spike (forge-pipeline task 1.1, requirement 1). Owner-only, paid, never run by tests.
//   GEMINI_API_KEY=... node scripts/forge-spike.mjs [--force]
// For 3 preset prompts (assets/characters/presets/PROMPTS.md, characters 1, 3 and 5) it generates a
// portrait with portraitPrompt(), asks the segmentation model for parts with PARTS_PROMPT, and
// writes portrait, raw + parsed parts, a structural check, and overlays under var/forge-spike/.
// Cut, fill and assemble (tasks 3-6) are not in this script yet; the decision record says so.
//
// Paid-call discipline: each call is retried at most once (network error, timeout, 429, 5xx), and
// the script refuses to run again over an existing var/forge-spike/summary.json without --force.
// The key is sent only in the x-goog-api-key header; it is never printed or written, and any
// upstream text that is recorded is scrubbed of it first.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const OUT = join("var", "forge-spike");
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 120_000; // generous on purpose: the spike measures real latency (server cap is 55 s)
const IMAGE_MODEL = process.env.SR_IMAGE_MODEL || "gemini-3-pro-image";
const SEGMENT_MODEL = process.env.SR_SEGMENT_MODEL || "gemini-3.8-flash";

// Exact strings from .kiro/specs/forge-pipeline/design.md "Prompts (exact)". Duplicated here
// because packages/forge/src/prompts.ts (task 2.1) does not exist yet and this is plain .mjs.
const HOUSE_STYLE =
  "Original character portrait, head and shoulders bust, facing the camera, centred, symmetrical framing, theatrical horror, painterly realism, dramatic rim light, the face clearly separated from the body, the jaw and eyes clearly visible, near-black (#050505) empty background, no text, no logos, no frame, not a real person, no gore, 1:1.";
const portraitPrompt = (t) => `${HOUSE_STYLE} The character: ${t.slice(0, 400)}`;
const PARTS_PROMPT =
  'This is a character portrait to be cut into animation layers. For each visible part among: head (skull/face, excluding crown, hair, hat and jaw), jaw (lower jaw that moves when speaking), eye_l (character\'s left eye), eye_r, monocle, crown (all crown spikes together), hat, hair, accessory (one other worn object on the head), torso (shoulders/robe), return a tight polygon outline. Return JSON: [{"name": string, "box_2d": [ymin,xmin,ymax,xmax], "poly": [[y,x],...]}] with coordinates normalized to 0-1000, 8-40 points per polygon, clockwise. Omit parts that are not visible.';
const PART_NAMES = ["head", "jaw", "eye_l", "eye_r", "monocle", "crown", "torso", "hat", "hair", "accessory"];

// Character texts from assets/characters/presets/PROMPTS.md (verbatim, line breaks joined).
const CHARACTERS = [
  {
    slug: "lantern-warden",
    preset: 1,
    expected: ["head", "jaw", "eye_l", "eye_r", "hat", "torso"],
    text: "A watchman whose head is a rotting carved gourd, mottled orange and moss-green, flecked with white mould. Two triangular eye holes burn with steady amber candlelight. The lower rind is cut as a separate hinged jaw with ragged carved teeth, lit from inside. A wide-brimmed, moth-eaten felt hat sits low. Shoulders in a damp oilcloth coat with a brass lantern hook at the collar.",
  },
  {
    slug: "understudy",
    preset: 3,
    expected: ["head", "jaw", "eye_l", "eye_r", "accessory", "torso"],
    text: "A theatre marionette loose of its strings: cracked ivory porcelain face, faded rose cheeks, glass eyes with a dim carmine glow. The jaw is a separate hinged wooden piece, two straight seams running down from the mouth corners. A small tarnished brass bell hangs on a ribbon across the brow. A deep crimson velvet theatre coat with gold piping and a white ruff.",
  },
  {
    slug: "announcer-of-dead-air",
    preset: 5,
    expected: ["head", "jaw", "eye_l", "eye_r", "hat", "crown", "torso"],
    text: "A tall hooded announcer whose face is a void of soft darkness: only two round eyes of violet phosphor and a wide mouth of flickering static-white teeth on a separate lower jaw. A deep hood of heavy black felt, frayed at the edge. Above the hood floats a broken ring of rusted antenna rods crackling with violet sparks. A collar of old microphone mesh.",
  },
];

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("forge-spike: GEMINI_API_KEY is not set. This spike makes paid calls and needs the owner's key.");
  process.exit(2);
}
if (existsSync(join(OUT, "summary.json")) && !process.argv.includes("--force")) {
  console.error(`forge-spike: ${join(OUT, "summary.json")} exists. Re-running spends money again; pass --force to do it anyway.`);
  process.exit(2);
}

const scrub = (s) => String(s).split(KEY).join("[redacted]").slice(0, 400);

/** One generateContent call, retried at most once on transient failure. Returns { json, ms, attempts }. */
async function generate(model, body) {
  const started = performance.now();
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let res;
    try {
      res = await fetch(`${API}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = { kind: err?.name === "TimeoutError" ? "timeout" : "network", message: scrub(err?.message ?? err) };
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      return { json: JSON.parse(text), ms: Math.round(performance.now() - started), attempts: attempt };
    }
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      // keep raw text
    }
    lastError = { kind: "http", status: res.status, message: scrub(message) };
    if (res.status !== 429 && res.status < 500) break;
  }
  const error = new Error(`${model}: ${lastError.kind} ${lastError.status ?? ""}`.trim());
  error.detail = { ...lastError, ms: Math.round(performance.now() - started) };
  throw error;
}

const partsOf = (json) => json?.candidates?.[0]?.content?.parts ?? [];

async function makePortrait(text) {
  const body = {
    contents: [{ role: "user", parts: [{ text: portraitPrompt(text) }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
  };
  const { json, ms, attempts } = await generate(IMAGE_MODEL, body);
  const image = partsOf(json).find((p) => p.inlineData?.data);
  if (!image) {
    const why = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason ?? "no image part";
    const error = new Error(`${IMAGE_MODEL}: no image (${why})`);
    error.detail = { kind: "no_image", reason: scrub(why), ms };
    throw error;
  }
  return { bytes: Buffer.from(image.inlineData.data, "base64"), mimeType: image.inlineData.mimeType, ms, attempts, usage: json.usageMetadata };
}

async function requestParts(bytes, mimeType) {
  const body = {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }, { text: PARTS_PROMPT }] }],
    generationConfig: { responseMimeType: "application/json" },
  };
  const { json, ms, attempts } = await generate(SEGMENT_MODEL, body);
  const raw = partsOf(json).filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  return { raw, ms, attempts, usage: json.usageMetadata };
}

/** Structural check mirroring requirement 3.2/3.3 (parseParts lands in task 2.2). */
function checkParts(raw) {
  let data;
  try {
    data = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch (err) {
    return { parsed: false, error: scrub(err.message), parts: [] };
  }
  if (!Array.isArray(data)) return { parsed: true, error: "not an array", parts: [] };
  const isCoord = (n) => Number.isInteger(n) && n >= 0 && n <= 1000;
  const report = data.map((p, i) => {
    const problems = [];
    if (!PART_NAMES.includes(p?.name)) problems.push(`unknown name ${JSON.stringify(p?.name)}`);
    if (!Array.isArray(p?.box_2d) || p.box_2d.length !== 4 || !p.box_2d.every(isCoord)) problems.push("bad box_2d");
    const poly = Array.isArray(p?.poly) ? p.poly : [];
    if (poly.length < 3 || poly.length > 60) problems.push(`poly has ${poly.length} points (3..60)`);
    if (!poly.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(isCoord))) problems.push("bad poly point");
    return { index: i, name: p?.name, points: poly.length, problems };
  });
  const valid = report.filter((r) => r.problems.length === 0);
  const names = valid.map((r) => r.name);
  return {
    parsed: true,
    total: data.length,
    valid: valid.length,
    headPresent: names.includes("head"),
    duplicates: names.filter((n, i) => names.indexOf(n) !== i),
    parts: report,
    data,
  };
}

// ---- overlays: SVG always; PNG composite when the portrait is an 8-bit RGB/RGBA PNG ----
const COLOURS = {
  head: [255, 80, 80], jaw: [255, 200, 40], eye_l: [60, 220, 255], eye_r: [60, 140, 255], monocle: [200, 120, 255],
  crown: [255, 120, 220], torso: [80, 255, 120], hat: [255, 150, 60], hair: [180, 255, 60], accessory: [255, 255, 255],
};
const colourOf = (name) => COLOURS[name] ?? [128, 128, 128];

function overlaySvg(portraitFile, w, h, parts) {
  const shapes = parts
    .filter((p) => Array.isArray(p?.poly))
    .map((p) => {
      const [r, g, b] = colourOf(p.name);
      const pts = p.poly.map(([y, x]) => `${((x / 1000) * w).toFixed(1)},${((y / 1000) * h).toFixed(1)}`).join(" ");
      const [y0, x0] = p.poly[0] ?? [0, 0];
      return `<polygon points="${pts}" fill="rgb(${r},${g},${b})" fill-opacity="0.22" stroke="rgb(${r},${g},${b})" stroke-width="3"/>` +
        `<text x="${(x0 / 1000) * w}" y="${(y0 / 1000) * h}" fill="rgb(${r},${g},${b})" font-size="22" font-family="sans-serif">${p.name}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<image href="${portraitFile}" width="${w}" height="${h}"/>\n${shapes}\n</svg>\n`;
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === "IHDR") [w, h, depth, type, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]];
    if (kind === "IDAT") idat.push(data);
    if (kind === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) return { w, h, rgb: null };
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (src[x] + pred) & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) px.copy(rgb, i * 3, i * bpp, i * bpp + 3);
  return { w, h, rgb };
}

/** Width and height from a JPEG's SOFn marker (no pixel decode). */
function jpegSize(buf) {
  let off = 2;
  while (off + 9 < buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5), rgb: null };
    }
    off += 2 + buf.readUInt16BE(off + 2);
  }
  return null;
}

function encodePng(w, h, rgb) {
  const rows = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y += 1) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (kind, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(kind, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function overlayPng(img, parts) {
  const { w, h } = img;
  const rgb = Buffer.from(img.rgb);
  const blend = (x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    rgb[i] = rgb[i] * (1 - a) + r * a;
    rgb[i + 1] = rgb[i + 1] * (1 - a) + g * a;
    rgb[i + 2] = rgb[i + 2] * (1 - a) + b * a;
  };
  for (const part of parts) {
    if (!Array.isArray(part?.poly) || part.poly.length < 3) continue;
    const colour = colourOf(part.name);
    const pts = part.poly.map(([y, x]) => [(x / 1000) * w, (y / 1000) * h]);
    for (let y = 0; y < h; y += 1) {
      const xs = [];
      for (let i = 0; i < pts.length; i += 1) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y + 0.5) !== (y2 <= y + 0.5)) xs.push(x1 + ((y + 0.5 - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x < xs[k + 1] - 0.5; x += 1) blend(x, y, colour, 0.22);
    }
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
      for (let s = 0; s <= steps; s += 1) {
        const x = Math.round(x1 + ((x2 - x1) * s) / Math.max(steps, 1)), y = Math.round(y1 + ((y2 - y1) * s) / Math.max(steps, 1));
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) blend(x + dx, y + dy, colour, 1);
      }
    }
  }
  return encodePng(w, h, rgb);
}

// ---- run ----
mkdirSync(OUT, { recursive: true });
const results = [];
for (const c of CHARACTERS) {
  const dir = join(OUT, c.slug);
  mkdirSync(dir, { recursive: true });
  const prompt = portraitPrompt(c.text);
  writeFileSync(join(dir, "prompt.txt"), `${prompt}\n`);
  const result = { slug: c.slug, preset: c.preset, textChars: c.text.length, truncated: c.text.length > 400, expected: c.expected, timings: {} };
  results.push(result);
  console.log(`forge-spike: ${c.slug}: portrait (${IMAGE_MODEL})...`);
  let portrait;
  try {
    portrait = await makePortrait(c.text);
  } catch (err) {
    result.portraitError = err.detail ?? { message: scrub(err.message) };
    console.error(`forge-spike: ${c.slug}: portrait failed: ${scrub(err.message)}`);
    continue;
  }
  const ext = portrait.mimeType === "image/png" ? "png" : portrait.mimeType === "image/jpeg" ? "jpg" : "img";
  const portraitFile = `portrait.${ext}`;
  writeFileSync(join(dir, portraitFile), portrait.bytes);
  // JPEG portraits (what gemini-3-pro-image returned on 2026-11-01) get an SVG overlay only.
  const img = ext === "png" ? decodePng(portrait.bytes) : ext === "jpg" ? jpegSize(portrait.bytes) : null;
  Object.assign(result, { portrait: join(dir, portraitFile), mimeType: portrait.mimeType, width: img?.w, height: img?.h, portraitAttempts: portrait.attempts, portraitUsage: portrait.usage });
  result.timings.portraitMs = portrait.ms;
  console.log(`forge-spike: ${c.slug}: portrait ${portrait.ms} ms; parts (${SEGMENT_MODEL})...`);
  let parts;
  try {
    parts = await requestParts(portrait.bytes, portrait.mimeType);
  } catch (err) {
    result.partsError = err.detail ?? { message: scrub(err.message) };
    console.error(`forge-spike: ${c.slug}: parts failed: ${scrub(err.message)}`);
    continue;
  }
  result.timings.partsMs = parts.ms;
  Object.assign(result, { partsAttempts: parts.attempts, partsUsage: parts.usage });
  writeFileSync(join(dir, "parts.raw.txt"), parts.raw);
  const check = checkParts(parts.raw);
  writeFileSync(join(dir, "check.json"), `${JSON.stringify({ ...check, data: undefined }, null, 2)}\n`);
  if (check.data) writeFileSync(join(dir, "parts.json"), `${JSON.stringify(check.data, null, 2)}\n`);
  const found = check.parts.filter((p) => p.problems.length === 0).map((p) => p.name);
  Object.assign(result, {
    parsed: check.parsed,
    partCount: check.total ?? 0,
    validParts: check.valid ?? 0,
    headPresent: check.headPresent ?? false,
    found,
    missingExpected: c.expected.filter((n) => !found.includes(n)),
    problems: check.parts.filter((p) => p.problems.length > 0),
    duplicates: check.duplicates ?? [],
  });
  const data = check.data ?? [];
  writeFileSync(join(dir, "overlay.svg"), overlaySvg(portraitFile, img?.w ?? 1024, img?.h ?? 1024, data));
  result.overlaySvg = join(dir, "overlay.svg");
  if (img?.rgb) {
    writeFileSync(join(dir, "overlay.png"), overlayPng(img, data));
    result.overlayPng = join(dir, "overlay.png");
  }
  console.log(`forge-spike: ${c.slug}: parts ${parts.ms} ms, ${result.validParts}/${result.partCount} valid, head ${result.headPresent}`);
}

const summary = { ranAt: new Date().toISOString(), imageModel: IMAGE_MODEL, segmentModel: SEGMENT_MODEL, timeoutMs: TIMEOUT_MS, results };
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`forge-spike: wrote ${join(OUT, "summary.json")}`);
