// Capturing Overlord's stage with O1's path. The lab stage composites one canvas, but Overlord's
// stage is a DOM layout around a WebGL face, so its pixels come from a tab capture
// (getDisplayMedia of the current tab, auto-accepted by --auto-accept-this-tab-capture; never
// --use-fake-ui-for-media-stream, which captures the desktop instead) with the tab's own audio.
// The resulting stream goes through `new MediaRecorder(stream)`, which O1's init script
// (director/output/o1/capture.ts) turns into the same live chunks -> ffmpeg -> RTMP -> run.flv.
import { chromium, type Browser, type Page } from "playwright";
import { captureScript } from "../director/output/o1/capture.js";
import { GPU_FLAGS, STAGE_HEIGHT, STAGE_WIDTH } from "../director/stage/browser.js";

/** Called with a user gesture (CDP Runtime.evaluate userGesture) once the stage is up. */
export const TAB_CAPTURE_CALL = "window.__labTabCapture()";

/**
 * Overlord's stage never voices an automated browser (`navigator.webdriver`, apps/stage/src/App.tsx);
 * the lab needs its audio, so the capture reports a normal browser. Nothing else is changed.
 */
export function tabCaptureScript(): string {
  return `(() => {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
  // Headless tab capture delivers a silent audio track, so the audio is taken where the lab's own
  // stage takes it: a MediaStreamDestination on the page's AudioContext, fed by whatever the page
  // connects to its speakers (same context, no cross-context hop that would shift A/V).
  const taps = new Map();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const out = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      const ctx = target.context;
      if (!taps.has(ctx)) taps.set(ctx, ctx.createMediaStreamDestination());
      connect.call(this, taps.get(ctx));
    }
    return out;
  };
  window.__labTabCapture = async () => {
    const until = performance.now() + 30000;
    while (taps.size === 0 && performance.now() < until) await new Promise((r) => setTimeout(r, 200));
    const tap = [...taps.values()].at(-1);
    const tab = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: ${STAGE_WIDTH}, height: ${STAGE_HEIGHT} },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    });
    const stream = new MediaStream([...tab.getVideoTracks(), ...(tap === undefined ? [] : tap.stream.getAudioTracks())]);
    new MediaRecorder(stream);
    const v = stream.getVideoTracks()[0];
    return JSON.stringify({ video: v === undefined ? null : v.getSettings(), audioTracks: stream.getAudioTracks().length, audioContexts: taps.size });
  };
})();`;
}

export interface CapturedStage {
  browser: Browser;
  page: Page;
  /** Starts the tab capture with a user gesture; returns the track settings (JSON text). */
  startCapture(): Promise<string>;
}

/** Opens `url` in Chromium (lab GPU flags + tab-capture auto-accept), with O1's chunk binding. */
export async function openCapturedStage(url: string, headless: boolean, onChunk: (seq: number, chunk: Buffer) => void, log: (line: string) => void): Promise<CapturedStage> {
  const args = [...GPU_FLAGS, "--use-angle=default", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--auto-accept-this-tab-capture"];
  const browser = await chromium.launch({ headless, channel: "chromium", args });
  const context = await browser.newContext({ viewport: { width: STAGE_WIDTH, height: STAGE_HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => log(`overlord stage error: ${error.message}`));
  await page.exposeBinding("__labO1Chunk", (_source, seq: unknown, base64: unknown) => {
    if (typeof seq === "number" && typeof base64 === "string") onChunk(seq, Buffer.from(base64, "base64"));
  });
  await page.addInitScript(captureScript());
  await page.addInitScript(tabCaptureScript());
  await page.goto(url);
  const cdp = await context.newCDPSession(page);
  return {
    browser,
    page,
    async startCapture() {
      const r: unknown = await cdp.send("Runtime.evaluate", { expression: TAB_CAPTURE_CALL, userGesture: true, awaitPromise: true, returnByValue: true });
      const result = typeof r === "object" && r !== null && "result" in r ? r.result : undefined;
      const value = typeof result === "object" && result !== null && "value" in result ? result.value : undefined;
      if (typeof value !== "string") throw new Error(`Tab capture did not start: ${JSON.stringify(r)}`);
      return value;
    },
  };
}
