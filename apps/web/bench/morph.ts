// Morph capture page (companion-lanes task 1, D; requirement 6.1): ONE deterministic frame of a morph
// rig through the player's own frame body (createFrameBody: driver override, mood, mouth state, the
// morph plan) and the real renderer (createRenderer: WebGL2, or its canvas2D fallback), then
// `document.documentElement.dataset.ready = "1"` ("error" on a failure, with `window.morphError`).
// `window.morphPng()` returns the drawn canvas as a PNG data URL with its alpha (composited over
// `bg` when one is set), `window.morphInfo` the renderer mode, the GPU and the frame's plan.
//
// Query (all optional): pack=<url> a .srpack, or job=<url> a built character's job.json ({ rig })
// with its images at files=<url> (default: beside it); default: the synthetic rig of morphSynth.ts;
// t=<s> (default 0: the breath's rest phase, so the rig's px map 1:1 to the canvas's); blink=0..1; gx, gy=-1..1 (the gaze); yaw, pitch=degrees; emotion=<Emotion>;
// shapes=openWide:0.5,round:0.5 (a caller's viseme mix; the rest is `rest`); level=0..1 (the speech
// level, used when no shapes); sway=x,y (the lag L, overriding the frozen frame's 0); key=<id>:<w>[,...]
// (those keys at those weights, bypassing the tracks); bg=<css colour> (default transparent);
// size=<px> (the square canvas, default 512); mode=2d forces the canvas2D fallback.
import { createCanvas2dRenderer, createFrameBody, createRenderer, cutoutLook, type FrameClock, type Renderer, type RigAssets } from "@sr/avatar";
import { decodePackImages, loadPack } from "@sr/pack";
import { defaultLook, EMOTION_TABLE, emptyMorphPlan, selectMorphKeys, validateRig, type Drive, type Emotion, type Look, type Rig } from "@sr/rig";
import { synthAssets, synthRig } from "./morphSynth";

declare global {
  interface Window {
    morphPng?: () => string;
    morphInfo?: { mode: string; gpu: string; keys: { id: string; weight: number }[]; sway: { x: number; y: number } | null };
    morphError?: string;
  }
}

const params = new URLSearchParams(window.location.search);
const num = (key: string, fallback = 0): number => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) ? v : fallback;
};

/** "a:0.5,b:0.25" -> { a: 0.5, b: 0.25 }. */
function pairs(text: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (text ?? "").split(",")) {
    const [k, v] = part.split(":");
    const n = Number(v);
    if (k !== undefined && k !== "" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** A built character folder (tools/portrait-keys): its job.json's rig, validated, and its images. */
async function loadJob(job: string): Promise<{ rig: Rig; look: Look; assets: RigAssets }> {
  const url = new URL(job, window.location.href);
  const value: unknown = await (await fetch(url)).json();
  const checked = validateRig(typeof value === "object" && value !== null && "rig" in value ? value.rig : value);
  if (!checked.ok) throw new Error(`job ${job}: ${checked.errors.map((e) => e.message).join("; ")}`);
  const rig = checked.value;
  const base = new URL(params.get("files") ?? ".", url);
  const raw = new Set([rig.morph?.flow, rig.morph?.sway?.map]);
  const files = [...new Set([...rig.layers.map((l) => l.file), rig.morph?.atlas, ...raw].filter((f): f is string => f !== undefined))];
  const assets: RigAssets = {};
  for (const file of files) {
    const blob = await (await fetch(new URL(file, base))).blob();
    assets[file] = await createImageBitmap(blob, raw.has(file) ? { premultiplyAlpha: "none", colorSpaceConversion: "none" } : { premultiplyAlpha: "premultiply" });
  }
  return { rig, look: defaultLook(rig), assets };
}

async function load(): Promise<{ rig: Rig; look: Look; assets: RigAssets }> {
  const pack = params.get("pack");
  const job = params.get("job");
  if (job !== null) return loadJob(job);
  if (pack === null) {
    const rig = synthRig();
    return { rig, look: defaultLook(rig), assets: await synthAssets() };
  }
  const result = await loadPack(pack);
  if (!result.ok) throw new Error(`pack ${pack}: ${result.error.code} ${result.error.detail}`);
  return { rig: result.pack.rig, look: result.pack.look, assets: await decodePackImages(result.pack.files, result.pack.rig) };
}

function gpuOf(canvas: HTMLCanvasElement, mode: string): string {
  if (mode !== "webgl2") return "none";
  const gl = canvas.getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl === null || gl === undefined || ext === null || ext === undefined ? "unknown" : String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
}

async function main(): Promise<void> {
  const size = Math.max(16, Math.round(num("size", 512)));
  const bg = params.get("bg");
  if (bg !== null) document.body.style.background = bg;
  const canvas = document.getElementById("morph");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("page markup is missing");
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = size;
  canvas.height = size;
  const { rig, look: saved, assets } = await load();
  const emotion = params.get("emotion");
  const look: Look = cutoutLook(emotion !== null && emotion in EMOTION_TABLE ? { ...saved, emotion: emotion as Emotion } : saved);
  const renderer: Renderer = params.get("mode") === "2d" ? createCanvas2dRenderer(canvas, canvas.getContext("2d"), rig, assets) : createRenderer(canvas, rig, assets);
  renderer.resize(size, size, 1);

  // The frozen drive: no springs (a `drive` override), the mood settled.
  const drive: Drive = { t: num("t"), headYaw: num("yaw"), headPitch: num("pitch"), jawOpen: 0, blink: num("blink"), ...(params.has("gx") || params.has("gy") ? { gaze: { x: num("gx"), y: num("gy") } } : {}) };
  const shapes = pairs(params.get("shapes"));
  const shown = Object.values(shapes).reduce((a, b) => a + b, 0);
  const mouth = Object.keys(shapes).length === 0 ? undefined : { shapes: { rest: Math.max(0, 1 - shown), openWide: 0, openMid: 0, round: 0, closed: 0, teeth: 0, tongue: 0, narrow: 0, ...shapes } };
  const body = createFrameBody(1);
  const out = body({ rig, look, dt: 0, level: num("level"), gaze: "host", reducedMotion: false, drive, assets, ...(mouth === undefined ? {} : { mouth }) });

  // Overrides: forced key weights (bypassing the tracks) and the sway lag.
  let clock: FrameClock = out.clock;
  const forced = pairs(params.get("key"));
  const [sx, sy] = (params.get("sway") ?? "").split(",").map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const morph = rig.morph;
  if (morph !== undefined && (Object.keys(forced).length > 0 || params.has("sway"))) {
    let plan = clock.morph?.plan;
    if (Object.keys(forced).length > 0) {
      const own = emptyMorphPlan(morph);
      morph.keys.forEach((k, i) => (own.weights[i] = forced[k.id] ?? 0));
      plan = selectMorphKeys(own);
    }
    const lag = params.has("sway") ? { x: sx ?? 0, y: sy ?? 0 } : (clock.morph?.sway ?? { x: 0, y: 0 });
    clock = { ...clock, morph: { plan: plan ?? emptyMorphPlan(morph), sway: lag } };
  }
  renderer.draw(out.poses, look, clock);

  // Copy the drawing buffer now (same task as the draw, so it is still there), over `bg` if set.
  const copy = document.createElement("canvas");
  copy.width = size;
  copy.height = size;
  const ctx = copy.getContext("2d");
  if (ctx === null) throw new Error("no 2d context for the copy");
  if (bg !== null) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(canvas, 0, 0);
  const png = copy.toDataURL("image/png");
  const mode = renderer.info().mode;
  const plan = clock.morph?.plan;
  window.morphPng = () => png;
  window.morphInfo = {
    mode,
    gpu: gpuOf(canvas, mode),
    keys: plan === undefined ? [] : Array.from(plan.active.subarray(0, plan.count), (i) => ({ id: rig.morph?.keys[i]?.id ?? "?", weight: plan.weights[i] ?? 0 })),
    sway: clock.morph === undefined ? null : { ...clock.morph.sway },
  };
  document.documentElement.dataset.ready = "1";
}

main().catch((error: unknown) => {
  window.morphError = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.ready = "error";
});
