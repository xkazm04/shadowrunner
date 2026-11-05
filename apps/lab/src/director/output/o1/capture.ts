// O1's page half, injected by Playwright (no page source changes): the stage page opened with
// `record=webm` builds its composite canvas + audio stream and hands them to `new MediaRecorder`.
// This init script replaces MediaRecorder with an inert stand-in that keeps O0's in-memory recorder
// from buffering the whole run, and records the same stream itself as small live chunks
// (Matroska H.264 + Opus when Chromium offers it, else WebM VP8 + Opus) that it passes to the
// director through a Playwright binding, in order. The director pipes them into ffmpeg's stdin.

/** The binding the page calls with each chunk (base64) and its sequence number. */
export const CHUNK_BINDING = "__labO1Chunk";
/** Page-side stop: ends the live recorder and resolves once its last chunk is delivered. */
export const STOP_EXPRESSION = "window.__labO1 === undefined ? 'no-stream' : window.__labO1.stop()";
/** Page-side probe: the container the page chose, or undefined before the stage started. */
export const MIME_EXPRESSION = "window.__labO1 === undefined ? undefined : window.__labO1.mimeType";

/** Container/codec preference: H.264 needs no extra transcode work in Chromium's recorder. */
export const MIME_PREFERENCE = ["video/x-matroska;codecs=avc1,opus", "video/webm;codecs=vp8,opus", "video/webm"];

export interface CaptureOptions {
  /** MediaRecorder timeslice: how often a chunk leaves the page. */
  timesliceMs: number;
  videoBitsPerSecond: number;
  /** A keyframe at least this often, so a restarted publisher can join at the next cluster. */
  keyframeMs: number;
}

export const CAPTURE_DEFAULTS: CaptureOptions = { timesliceMs: 250, videoBitsPerSecond: 12_000_000, keyframeMs: 1000 };

/** The init script (runs before the page's own modules). */
export function captureScript(options: CaptureOptions = CAPTURE_DEFAULTS): string {
  const config = JSON.stringify({ ...options, mimes: MIME_PREFERENCE, binding: CHUNK_BINDING });
  return `(() => {
  const cfg = ${config};
  // Both stages (the lab's, Overlord's) are Vite dev servers: an edit in the served tree would make
  // Vite's client reload the page mid-run, dropping the recording (and the lab director's queued
  // "load"). The lab server now runs with hmr off; Overlord's does not, so the HMR socket is refused
  // here too (closed unopened: Vite logs one warning and stops trying).
  const RealSocket = window.WebSocket;
  window.WebSocket = new Proxy(RealSocket, {
    construct(target, args) {
      const protocols = args[1];
      const hmr = protocols === "vite-hmr" || protocols === "vite-ping" || (Array.isArray(protocols) && protocols.includes("vite-hmr"));
      if (!hmr) return Reflect.construct(target, args);
      const dead = new EventTarget();
      Object.assign(dead, { readyState: 3, send() {}, close() {} });
      setTimeout(() => dead.dispatchEvent(new CloseEvent("close", { code: 1006, wasClean: false })), 0);
      return dead;
    },
  });
  const Real = window.MediaRecorder;
  if (Real === undefined) return;
  const toBase64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const live = (stream) => {
    const mimeType = cfg.mimes.find((t) => Real.isTypeSupported(t));
    const rec = new Real(stream, {
      ...(mimeType === undefined ? {} : { mimeType }),
      videoBitsPerSecond: cfg.videoBitsPerSecond,
      audioBitsPerSecond: 192000,
      videoKeyFrameIntervalDuration: cfg.keyframeMs,
    });
    let seq = 0;
    let chain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const n = seq++;
      chain = chain.then(async () => window[cfg.binding](n, toBase64(new Uint8Array(await e.data.arrayBuffer())))).catch(() => undefined);
    };
    rec.start(cfg.timesliceMs);
    window.__labO1 = {
      mimeType: mimeType ?? "video/webm",
      stop: () => new Promise((resolve) => {
        if (rec.state === "inactive") return resolve(chain.then(() => "stopped"));
        rec.addEventListener("stop", () => resolve(chain.then(() => "stopped")), { once: true });
        rec.stop();
      }),
    };
  };
  class InertRecorder extends EventTarget {
    constructor(stream) {
      super();
      this.state = "inactive";
      this.ondataavailable = null;
      live(stream);
    }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.dispatchEvent(new Event("stop")); }
    static isTypeSupported(t) { return Real.isTypeSupported(t); }
  }
  window.MediaRecorder = InertRecorder;
})();`;
}
