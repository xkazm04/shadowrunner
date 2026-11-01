// Avatar frame-time bench (avatar-renderer task 6, req 7.3): Malakor idle for 10 s through the same
// path as <AvatarCanvas> (driver frame -> poseLayers -> renderer), then median and p95 of the frame
// interval (rAF to rAF, what a viewer sees) and of the CPU time spent per frame, plus `info()`.
// Results go to #result and `window.avatarBench`; `data-done` on <body> marks the end.
// ?react=1 mounts <AvatarCanvas> instead (a live check of the wrapper in a real browser; no timing).
import "@sr/theme/halloween.css";
import { advanceFrame, AvatarCanvas, createCanvas2dRenderer, createRenderer, initialState, type Renderer, type RigAssets } from "@sr/avatar";
import { defaultLook, EMOTION_TABLE, importLegacyLayers, poseLayers, type Drive, type Emotion, type Look, type Rig } from "@sr/rig";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import layersJson from "../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../assets/characters/malakor/rig/m8.spec.json";

const PNG_URLS = import.meta.glob<string>("../../../assets/characters/malakor/rig/*.png", { query: "?url", import: "default", eager: true });

export interface BenchResult {
  mode: "webgl2" | "2d";
  frames: number;
  seconds: number;
  intervalMs: { median: number; p95: number };
  cpuMs: { median: number; p95: number };
  drawCalls: number;
  textureUploads: number;
  visibleLayers: number;
}

declare global {
  interface Window {
    avatarBench?: BenchResult;
  }
}

const params = new URLSearchParams(window.location.search);
const out = document.getElementById("result");
const stage = document.getElementById("stage");
const canvas = document.getElementById("avatar");

function report(text: string): void {
  if (out !== null) out.textContent = text;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))] ?? NaN;
}

function malakor(): Rig {
  const result = importLegacyLayers(layersJson, specJson);
  if (!result.ok) throw new Error(`Malakor did not import: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.value.rig;
}

async function loadAssets(rig: Rig): Promise<RigAssets> {
  const byName = new Map(Object.entries(PNG_URLS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));
  const assets: RigAssets = {};
  await Promise.all(
    rig.layers.map(async (layer) => {
      const url = byName.get(layer.file);
      if (url === undefined) throw new Error(`missing ${layer.file}`);
      const image = new Image();
      image.src = url;
      await image.decode();
      assets[layer.file] = image;
    }),
  );
  return assets;
}

/** A frozen Drive from the query (?t, ?yaw, ?pitch, ?jaw, ?blink), for screenshots; none when absent. */
function frozenDrive(): Drive | undefined {
  const keys = ["t", "yaw", "pitch", "jaw", "blink"];
  if (!keys.some((k) => params.has(k))) return undefined;
  const n = (k: string): number => Number(params.get(k) ?? 0) || 0;
  return { t: n("t"), headYaw: n("yaw"), headPitch: n("pitch"), jawOpen: n("jaw"), blink: n("blink") };
}

function lookFor(rig: Rig): Look {
  const emotion = params.get("emotion");
  const look = defaultLook(rig);
  return emotion !== null && emotion in EMOTION_TABLE ? { ...look, emotion: emotion as Emotion } : look;
}

function rendererFor(target: HTMLCanvasElement, rig: Rig, assets: RigAssets): Renderer {
  return params.get("mode") === "2d" ? createCanvas2dRenderer(target, target.getContext("2d"), rig, assets) : createRenderer(target, rig, assets);
}

/** ?react=1: the wrapper itself, idle, for `seconds`; reports the renderer mode it ended in. */
function mountReact(host: HTMLElement, rig: Rig, assets: RigAssets, look: Look, seconds: number): void {
  host.replaceChildren();
  const drive = frozenDrive();
  createRoot(host).render(createElement(AvatarCanvas, { rig, look, assets, className: "face", ...(drive === undefined ? {} : { drive }) }));
  window.setTimeout(() => {
    report(`AvatarCanvas mounted: ${host.querySelectorAll("canvas").length} canvas`);
    document.body.dataset.done = "1";
  }, seconds * 1000);
}

async function main(): Promise<void> {
  if (!(canvas instanceof HTMLCanvasElement) || stage === null) throw new Error("bench markup is missing");
  const rig = malakor();
  const assets = await loadAssets(rig);
  const look = lookFor(rig);
  if (params.get("react") === "1") {
    mountReact(stage, rig, assets, look, Number(params.get("seconds") ?? 2) || 2);
    return;
  }
  const renderer = rendererFor(canvas, rig, assets);
  const resize = (): void => renderer.resize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio || 1);
  resize();
  window.addEventListener("resize", resize);

  const seconds = Number(params.get("seconds") ?? 10) || 10;
  const frozen = frozenDrive();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state = initialState(Number(params.get("seed") ?? 1) || 1);
  const intervals: number[] = [];
  const cpu: number[] = [];
  let start: number | undefined;
  let last: number | undefined;
  let visible = 0;

  const finish = (): void => {
    const info = renderer.info();
    const result: BenchResult = {
      mode: info.mode,
      frames: cpu.length,
      seconds,
      intervalMs: { median: percentile(intervals, 0.5), p95: percentile(intervals, 0.95) },
      cpuMs: { median: percentile(cpu, 0.5), p95: percentile(cpu, 0.95) },
      drawCalls: info.drawCalls,
      textureUploads: info.textureUploads,
      visibleLayers: visible,
    };
    window.avatarBench = result;
    report(JSON.stringify(result, null, 2));
    document.body.dataset.done = "1";
  };

  const frame = (now: number): void => {
    const begin = performance.now();
    const dt = last === undefined ? 0 : (now - last) / 1000;
    if (last !== undefined) intervals.push(now - last);
    last = now;
    start ??= now;
    const next = advanceFrame(state, { dt, level: 0, gaze: "host", reducedMotion, ...(frozen === undefined ? {} : { drive: frozen }) });
    state = next.state;
    const poses = poseLayers(rig, look, next.drive);
    visible = poses.length;
    renderer.draw(poses, look, { t: next.drive.t, reducedMotion });
    cpu.push(performance.now() - begin);
    if (now - start < seconds * 1000) {
      requestAnimationFrame(frame);
      report(`running ${renderer.info().mode} ${((now - start) / 1000).toFixed(1)} / ${seconds} s`);
    } else {
      finish();
    }
  };
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  report(`bench failed: ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.done = "error";
});
