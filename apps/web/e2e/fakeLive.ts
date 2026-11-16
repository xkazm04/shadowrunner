// A fake `fhl/1` live server for the /live e2e test (spec flashhead-live, task 3): node `ws` on one
// port, `GET /health`, the origin check, a never-ending 25 fps stream of synthetic JPEG frames to
// every `out` client, and for each `say` a 1 s sine tone (24 kHz PCM16) with line-start, timing
// and line-end, all on one pts clock. The binary layout is written here independently of
// src/live/protocol.ts, so the test cross-checks the page's decoder. Run it alone for a manual
// look at /live without the GPU:  node apps/web/e2e/fakeLive.ts [port]
import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

export const FAKE_PORT = 8790;
const FPS = 25;
const FRAME_MS = 1000 / FPS;
const SIZE = 512;
const RATE = 24000;
const TONE_HZ = 440;

export interface FakeLive {
  url: string;
  /** Every JSON message received, in order, with the client's role. */
  received: { role: string; message: Record<string, unknown> }[];
  /** Binary messages received: their tags. */
  binary: number[];
  close(): Promise<void>;
}

/** 25 distinct frames: a dark field whose tint shifts, with a bright square that travels. */
async function makeFrames(): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (let i = 0; i < FPS; i += 1) {
    const raw = Buffer.alloc(SIZE * SIZE * 3);
    const x0 = 40 + i * 16;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const at = (y * SIZE + x) * 3;
        const square = x >= x0 && x < x0 + 96 && y >= 200 && y < 296;
        raw[at] = square ? 250 : 20 + i * 6;
        raw[at + 1] = square ? 240 : 40;
        raw[at + 2] = square ? 200 : 90 - i * 2;
      }
    }
    frames.push(await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 90 }).toBuffer());
  }
  return frames;
}

function video(pts: number, jpeg: Buffer): Buffer {
  const head = Buffer.alloc(13);
  head.writeUInt8(0x01, 0);
  head.writeDoubleLE(pts, 1);
  head.writeUInt16LE(SIZE, 9);
  head.writeUInt16LE(SIZE, 11);
  return Buffer.concat([head, jpeg]);
}

function audio(pts: number, samples: Int16Array): Buffer {
  const out = Buffer.alloc(13 + samples.length * 2);
  out.writeUInt8(0x02, 0);
  out.writeDoubleLE(pts, 1);
  out.writeUInt32LE(RATE, 9);
  samples.forEach((s, i) => out.writeInt16LE(s, 13 + 2 * i));
  return out;
}

function slideOut(index: number, image: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(0x03, 0);
  head.writeUInt32LE(index, 1);
  return Buffer.concat([head, image]);
}

const allowed = (origin: string | undefined): boolean => origin === undefined || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export async function startFakeLive(port = FAKE_PORT): Promise<FakeLive> {
  const frames = await makeFrames();
  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      response.end(JSON.stringify({ ok: true, proto: "fhl/1" }));
    } else {
      response.writeHead(404).end();
    }
  });
  const wss = new WebSocketServer({ server: http, path: "/live" });
  const roles = new Map<WebSocket, string>();
  const received: FakeLive["received"] = [];
  const binary: number[] = [];
  const started = performance.now();
  const timers = new Set<NodeJS.Timeout>();
  let frame = 0;
  let upscale = "none";
  let source = "text";
  let pendingSlide: number | undefined;

  const clock = () => performance.now() - started;
  const state = () => JSON.stringify({ type: "state", ready: true, model: "lite", fps: FPS, upscale, source, queue: 0, delayMs: 250, size: SIZE });
  const each = (role: string | undefined, data: string | Buffer) => {
    for (const [ws, r] of roles) if (role === undefined || r === role) ws.send(data);
  };
  const event = (kind: string, id: string | null, text: string | null, atMs: number) => each(undefined, JSON.stringify({ type: "event", kind, id, text, atMs }));
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const ticker = setInterval(() => {
    // Catch up to the wall clock: frame i has pts i * 40.
    while (frame * FRAME_MS <= clock()) {
      each("out", video(frame * FRAME_MS, frames[frame % frames.length] ?? Buffer.alloc(0)));
      frame += 1;
    }
  }, FRAME_MS / 2);

  const say = (id: string) => {
    const at = frame * FRAME_MS;
    const asked = clock();
    for (let k = 0; k < FPS; k += 1) {
      const samples = new Int16Array((RATE * FRAME_MS) / 1000);
      samples.forEach((_, n) => (samples[n] = Math.round(8000 * Math.sin((2 * Math.PI * TONE_HZ * (k * samples.length + n)) / RATE))));
      each("out", audio(at + k * FRAME_MS, samples));
    }
    event("line-start", id, null, at);
    each("control", JSON.stringify({ type: "timing", id, firstFrameMs: Math.max(0, at - asked), chunkMs: 410, upscaleMs: null }));
    later(() => event("line-end", id, null, at + 1000), 1000);
  };

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    if (!allowed(request.headers.origin)) return ws.close(4403, "origin");
    ws.on("message", (data: RawData, isBinary: boolean) => {
      const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (isBinary) {
        const tag = buffer.readUInt8(0);
        binary.push(tag);
        if (tag === 0x13 && pendingSlide !== undefined) each("out", slideOut(pendingSlide, buffer.subarray(1)));
        pendingSlide = undefined;
        return;
      }
      const message = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
      received.push({ role: roles.get(ws) ?? "none", message });
      if (message.type === "hello") {
        roles.set(ws, String(message.role));
        ws.send(state());
      } else if (message.type === "say") say(String(message.id));
      else if (message.type === "upscale") {
        upscale = String(message.kind);
        each(undefined, state());
      } else if (message.type === "source") {
        source = String(message.source);
        each(undefined, state());
      } else if (message.type === "slide") {
        pendingSlide = Number(message.index);
        event("slide", null, String(message.index), frame * FRAME_MS);
      }
    });
    ws.on("close", () => roles.delete(ws));
  });

  await new Promise<void>((resolve) => http.listen(port, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${port}/live`,
    received,
    binary,
    close: async () => {
      clearInterval(ticker);
      for (const t of timers) clearTimeout(t);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? FAKE_PORT);
  void startFakeLive(port).then((fake) => {
    console.log(`fake fhl/1 server on ${fake.url} (Ctrl+C stops it)`);
    process.on("SIGINT", () => void fake.close().then(() => process.exit(0)));
  });
}
