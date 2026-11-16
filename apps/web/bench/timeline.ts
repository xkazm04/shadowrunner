// Timeline capture page (talking-head task 3): the REAL avatar player (`createAvatarPlayer`, its
// own frame body: blink, breathing, sway, gaze drift, mood fades, gestures) stepped by hand at
// 30 fps with `renderFrame(1 / 30)`, never on the rAF loop, so a capture is frame-exact and the
// same input gives the same frames. scripts/portrait/timeline-capture.mjs drives it.
//
// Query (all optional but one source):
// - pack=<url> the .srpack (default /packs/iris.srpack); size=<px> the square canvas (default 1024);
//   seed=<n> the player's seed (default 1); backdrop=0 draws the cutout (default: the rig's
//   `background` layer, so the frame is opaque).
// - timeline=<url> a th-timeline/1 (tools/talking-head/th/rig/timeline.py): per frame, `mouth` goes
//   through setMouthShapes, `mouthGain` through setLook (Look.face.mouth.size), `expression` through
//   setLook (the family's emotion, Look.face.expression.strength = w x the profile's), `gesture`
//   through gesture() on the frame it changes to a gesture. `blink` and `gaze` have no public
//   player API: a non-null value is counted in `timelineInfo.ignored` and not drawn. null = the
//   player's own behaviour.
// - audio=<url> the take's wav: its speech level drives `setLevel` every frame, as playLine's level
//   tap does in the studio (the RMS of the last LEVEL_FFT_SIZE samples at the context's rate).
//   Without a timeline the mouth is the studio's own lip-sync: `trackOfLine(buffer, text)` with
//   text=<url> (a .txt) and `trackShaper` (apps/web/src/reach/studio/lipsync.ts), exactly the
//   Record path's per-frame call before `renderFrame`. mouth=rest forces the rest mouth instead
//   (talking-head dub-ls: every other behaviour live).
//
// `window.renderFrame(i)` steps to frame i (calls must go 0, 1, 2, ...; frame 0 has dt 0) and
// returns that frame as a PNG data URL. `window.timelineInfo` describes the run; dataset.ready is
// "1" or "error" (`window.timelineError`).
import { createAvatarPlayer, LEVEL_FFT_SIZE, restWeights, rms, speechLevel, type AvatarPlayer, type MouthShape, type ShapeWeights } from "@sr/avatar";
import { decodePackImages, loadPack } from "@sr/pack";
import { EXPRESSION_FAMILIES, resolveFace, type Emotion, type ExpressionFamily, type Gesture, type Look, type Rig } from "@sr/rig";
import { trackOfLine, trackShaper } from "../src/reach/studio/lipsync";

export const FPS = 30;
/** The studio's AudioContext rate: its decodeAudioData resamples every clip to it. */
const CONTEXT_RATE = 48_000;
const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
/** The emotion a timeline's expression family is shown as (the milder of a family's two). */
export const FAMILY_EMOTION: Readonly<Record<ExpressionFamily, Emotion>> = { joy: "amused", showman: "theatrical", anger: "irritated", gloom: "grim", smug: "smug", suspicion: "suspicious" };

export interface TimelineFrame {
  t: number;
  mouth: Partial<Record<MouthShape, number>> | null;
  mouthGain: number | null;
  expression: { family: ExpressionFamily; w: number } | null;
  gesture: Gesture | null;
  blink: number | null;
  gaze: [number, number] | null;
}

export interface Timeline {
  schema: "th-timeline/1";
  fps: number;
  frames: TimelineFrame[];
}

declare global {
  interface Window {
    renderFrame?: (i: number) => string;
    timelineInfo?: { frames: number; fps: number; source: string; gpu: string; durationS: number; ignored: { blink: number; gaze: number } };
    timelineError?: string;
  }
}

const params = new URLSearchParams(window.location.search);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checks the fields the page reads (the full schema is th/rig/timeline.py's); throws on the first fault. */
export function checkTimeline(value: unknown): Timeline {
  const v = value as Partial<Timeline> | null;
  if (v === null || typeof v !== "object" || v.schema !== "th-timeline/1") throw new Error("timeline: schema is not th-timeline/1");
  if (v.fps !== FPS) throw new Error(`timeline: fps ${String(v.fps)} (only ${FPS})`);
  if (!Array.isArray(v.frames) || v.frames.length === 0) throw new Error("timeline: no frames");
  v.frames.forEach((f, i) => {
    if (!finite(f.t)) throw new Error(`timeline: frame ${i} has no t`);
    if (f.expression !== null && !EXPRESSION_FAMILIES.includes(f.expression.family)) throw new Error(`timeline: frame ${i} family ${String(f.expression.family)}`);
    if (f.gesture !== null && !GESTURES.includes(f.gesture)) throw new Error(`timeline: frame ${i} gesture ${String(f.gesture)}`);
  });
  return v as Timeline;
}

/** The speech level at `tS` (playLine's level tap: the last LEVEL_FFT_SIZE samples before tS). */
export function levelAt(samples: Float32Array, rate: number, tS: number): number {
  const end = Math.min(samples.length, Math.max(0, Math.round(tS * rate)));
  return speechLevel(rms(samples.subarray(Math.max(0, end - LEVEL_FFT_SIZE), end)));
}

async function decode(url: string): Promise<AudioBuffer> {
  const bytes = await (await fetch(url)).arrayBuffer();
  return new OfflineAudioContext(1, 1, CONTEXT_RATE).decodeAudioData(bytes);
}

function gpuOf(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl === null || gl === undefined || ext === null || ext === undefined ? "unknown" : String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
}

/** Applies a timeline frame's face (mouth, gain, expression, gesture) to the player. */
function timelineDriver(player: AvatarPlayer, rig: Rig, base: Look, timeline: Timeline, ignored: { blink: number; gaze: number }): (i: number) => void {
  const strength = resolveFace(rig, base).expression.strength;
  let lastLook = "";
  let lastGesture: Gesture | null = null;
  return (i) => {
    const f = timeline.frames[Math.min(i, timeline.frames.length - 1)];
    if (f === undefined) return;
    if (f.blink !== null) ignored.blink += 1;
    if (f.gaze !== null) ignored.gaze += 1;
    if (f.mouth === null) player.setMouthShapes?.(undefined);
    else {
      const shapes: ShapeWeights = { ...restWeights(), rest: 0, ...f.mouth };
      const shown = Object.entries(shapes).reduce((a, [k, w]) => (k === "rest" ? a : a + Math.max(0, w)), 0);
      shapes.rest = f.mouth.rest ?? Math.max(0, 1 - shown);
      player.setMouthShapes?.(shapes, { jaw: shapes });
    }
    const key = JSON.stringify([f.expression, f.mouthGain]);
    if (key !== lastLook) {
      lastLook = key;
      const face = { ...base.face };
      if (f.expression !== null) face.expression = { ...base.face?.expression, strength: Math.min(1, Math.max(0, f.expression.w)) * strength };
      if (f.mouthGain !== null) face.mouth = { ...base.face?.mouth, size: Math.min(1.5, Math.max(0.3, f.mouthGain)) };
      player.setLook({ ...base, ...(f.expression === null ? {} : { emotion: FAMILY_EMOTION[f.expression.family] }), face });
    }
    if (f.gesture !== null && f.gesture !== lastGesture) player.gesture(f.gesture);
    lastGesture = f.gesture;
  };
}

async function main(): Promise<void> {
  const size = Math.max(16, Math.round(Number(params.get("size") ?? 1024)));
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("page markup is missing");
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = size;
  canvas.height = size;
  const packUrl = params.get("pack") ?? "/packs/iris.srpack";
  const result = await loadPack(packUrl);
  if (!result.ok) throw new Error(`pack ${packUrl}: ${result.error.code} ${result.error.detail}`);
  const { rig, look } = result.pack;
  const assets = await decodePackImages(result.pack.files, result.pack.rig);
  const player = createAvatarPlayer(canvas, { rig, look, assets, seed: Number(params.get("seed") ?? 1), autoSize: false, reducedMotion: false, pauseOffscreen: false, backdrop: params.get("backdrop") !== "0" });
  player.resize(size, size, 1);

  const audioUrl = params.get("audio");
  const buffer = audioUrl === null ? undefined : await decode(audioUrl);
  const samples = buffer?.getChannelData(0);
  const timelineUrl = params.get("timeline");
  const timeline = timelineUrl === null ? undefined : checkTimeline(await (await fetch(timelineUrl)).json());
  if (timeline === undefined && buffer === undefined) throw new Error("timeline or audio is required");
  const ignored = { blink: 0, gaze: 0 };
  let clock = 0;
  let face: (i: number, dt: number) => void;
  let source: string;
  if (timeline !== undefined) {
    const drive = timelineDriver(player, rig, look, timeline, ignored);
    face = (i) => drive(i);
    source = "timeline";
  } else if (params.get("mouth") === "rest") {
    face = () => player.setMouthShapes?.(restWeights());
    source = "audio, mouth at rest";
  } else {
    const textUrl = params.get("text");
    const text = textUrl === null ? "" : await (await fetch(textUrl)).text();
    const track = buffer === undefined ? undefined : trackOfLine(buffer, text);
    if (track === undefined) throw new Error("the audio could not be analysed");
    const shaper = trackShaper(player, { track, reducedMotion: () => false }, () => clock);
    face = (_i, dt) => shaper.frame(dt);
    source = `audio + studio lip-sync (${text === "" ? "no text" : `${text.length} chars of text`})`;
  }
  const durationS = timeline !== undefined ? timeline.frames.length / FPS : (buffer?.duration ?? 0);
  const frames = timeline !== undefined ? timeline.frames.length : Math.ceil(durationS * FPS);

  const copy = document.createElement("canvas");
  copy.width = size;
  copy.height = size;
  const ctx = copy.getContext("2d");
  if (ctx === null) throw new Error("no 2d context for the copy");
  let next = 0;
  window.renderFrame = (i) => {
    if (i !== next) throw new Error(`renderFrame(${i}): frames go in order, the next is ${next}`);
    next += 1;
    const dt = i === 0 ? 0 : 1 / FPS;
    clock = i / FPS;
    if (samples !== undefined && buffer !== undefined) player.setLevel(levelAt(samples, buffer.sampleRate, clock));
    face(i, dt);
    player.renderFrame(dt);
    // Copied in the same task as the draw, so the WebGL buffer is still there.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(canvas, 0, 0);
    return copy.toDataURL("image/png");
  };
  window.timelineInfo = { frames, fps: FPS, source, gpu: gpuOf(canvas), durationS, ignored };
  document.documentElement.dataset.ready = "1";
}

main().catch((error: unknown) => {
  window.timelineError = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.ready = "error";
});
