// The Avatar Lab stage page. Query: ws=<port> (director socket), run=<runId>, debug=1 (event list),
// record=webm (O0 records the composite), motion=force (ignore prefers-reduced-motion; recording
// runs force it so every arm is measured with motion on).
//
// Director -> page: load (character + arms), pcm (utterance audio), event (timeline), end.
// Page -> director: ready{renderBackend}, audioStarted{id, atMs}, frameStats every second, error.
// No secret ever reaches this bundle: the page only receives text, PCM and events.
import "@sr/theme/halloween.css";
import type { AvatarPlayer } from "@sr/avatar/core";
import type { DirectorMessage, LipDriver, PageMessage, RunConfig, SceneDriver, TimelineEvent } from "../contract.js";
import { createStageSound, type StageSound } from "./audio.js";
import { detectBackend, loadCharacter, STAGE_H, STAGE_W } from "./character.js";
import { createDebugList, type DebugList } from "./debug.js";
import { createFrameMeter } from "./frames.js";
import { createLipDriver } from "./lip/index.js";
import { startRecorder, type StageRecorder } from "./recorder.js";
import { createSceneDriver } from "./scene/index.js";
import styles from "./stage.module.css";
import type { ScenePainter, Utterance } from "./types.js";

declare global {
  interface Window {
    /** O0's stop hook (director/output/o0.ts): ends the recording and uploads it. */
    __labStopRecording?: () => Promise<void>;
  }
}

const params = new URLSearchParams(location.search);
const runId = params.get("run") ?? "adhoc";
const recording = params.get("record") === "webm";
const forceMotion = recording || params.get("motion") === "force";
const reducedMotion = !forceMotion && matchMedia("(prefers-reduced-motion: reduce)").matches;

document.body.className = styles.body ?? "";
const stage = document.getElementById("stage") ?? document.body;
stage.className = styles.stage ?? "";
const avatarCanvas = document.createElement("canvas");
avatarCanvas.className = styles.avatar ?? "";
avatarCanvas.width = STAGE_W;
avatarCanvas.height = STAGE_H;
stage.append(avatarCanvas);
const debug: DebugList | undefined = params.get("debug") === "1" ? createDebugList(stage) : undefined;

const socket = new WebSocket(`ws://127.0.0.1:${params.get("ws") ?? "0"}`);
const send = (message: PageMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};
const fail = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  debug?.add(`error: ${message}`);
  send({ type: "error", message });
};

interface Running {
  player: AvatarPlayer;
  sound: StageSound;
  lip: LipDriver;
  scene: SceneDriver;
  recorder?: StageRecorder;
  stats: number;
  frame: number;
}
let running: Running | undefined;
/** `say` text by utterance id, delivered to scene hooks when that line's audio starts. */
const lines = new Map<string, string>();
const utteranceHooks: ((utterance: Utterance) => void)[] = [];

async function start(character: string, config: RunConfig): Promise<void> {
  const player = await loadCharacter(avatarCanvas, character, config.seed, forceMotion);
  const sound = createStageSound();
  const hooks: ((nowMs: number) => void)[] = [];
  const painters: Record<"back" | "mouth" | "front", ScenePainter[]> = { back: [], mouth: [], front: [] };
  // Arms are created from their registries; an unbuilt slot throws its sentence, reported as an error.
  const lip = createLipDriver(config.lip, {
    player,
    audio: sound,
    reducedMotion,
    addPainter: (painter) => painters.mouth.push(painter),
  });
  const scene = createSceneDriver(config.scene, {
    stage,
    audio: sound,
    reducedMotion,
    onFrame: (hook) => hooks.push(hook),
    addPainter: (layer, painter) => painters[layer].push(painter),
    onUtterance: (hook) => utteranceHooks.push(hook),
  });

  const composite = document.createElement("canvas");
  composite.width = STAGE_W;
  composite.height = STAGE_H;
  const g = recording ? composite.getContext("2d") : null;
  const meter = createFrameMeter();
  let last = performance.now();
  const frame = (now: number): void => {
    const nowMs = sound.nowMs();
    for (const hook of hooks) hook(nowMs);
    player.renderFrame(Math.min(0.1, Math.max(0, (now - last) / 1000)));
    last = now;
    lip.frame(nowMs);
    if (g !== null) {
      g.clearRect(0, 0, STAGE_W, STAGE_H);
      for (const p of painters.back) p(g, nowMs);
      g.drawImage(avatarCanvas, 0, 0);
      for (const p of painters.mouth) p(g, nowMs);
      for (const p of painters.front) p(g, nowMs);
    }
    meter.tick(now);
    if (running !== undefined) running.frame = requestAnimationFrame(frame);
  };
  const recorder = g === null ? undefined : startRecorder(composite, sound.stream, runId);
  running = {
    player,
    sound,
    lip,
    scene,
    ...(recorder === undefined ? {} : { recorder }),
    stats: window.setInterval(() => send({ type: "frameStats", ...meter.flush() }), 1000),
    frame: requestAnimationFrame(frame),
  };
  window.__labStopRecording = async () => {
    if (recorder === undefined) throw new Error("This page is not recording (no record=webm).");
    await recorder.stopAndUpload();
  };
  send({ type: "ready", renderBackend: detectBackend() });
}

function apply(event: TimelineEvent): void {
  debug?.add(event);
  const r = running;
  if (r === undefined) return;
  switch (event.kind) {
    case "say":
      lines.set(event.id, event.text);
      break;
    case "audio":
      if (r.sound.play(event.id, (atMs) => {
        send({ type: "audioStarted", id: event.id, atMs: Math.round(atMs) });
        r.lip.onAudio(event, atMs);
        const text = lines.get(event.id);
        if (text !== undefined) {
          const utterance = { id: event.id, text, atMs, durationMs: event.durationMs };
          for (const hook of utteranceHooks) hook(utterance);
        }
      }) === undefined) fail(`audio ${event.id} arrived without its PCM`);
      break;
    case "viseme":
      r.lip.onViseme(event);
      break;
    case "emotion":
      r.player.setEmotion(event.value);
      break;
    case "gesture":
      r.player.gesture(event.value);
      break;
    case "scene":
      r.scene.apply(event);
      break;
    default:
      break;
  }
}

function end(): void {
  const r = running;
  if (r === undefined) return;
  cancelAnimationFrame(r.frame);
  window.clearInterval(r.stats);
  debug?.add("end");
}

socket.addEventListener("message", (e: MessageEvent<string>) => {
  let message: DirectorMessage;
  try {
    message = JSON.parse(e.data);
  } catch {
    return;
  }
  try {
    if (message.type === "load") start(message.character, message.config).catch(fail);
    else if (message.type === "pcm") running?.sound.store(message.id, message.sampleRate, message.pcmBase64);
    else if (message.type === "event") apply(message.event);
    else if (message.type === "end") end();
  } catch (error) {
    fail(error);
  }
});
