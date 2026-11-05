// The stage: a Vite dev server for src/page (packs served from apps/web/public as /packs/*), the
// lab WebSocket (DirectorMessage out, PageMessage in) on its own port, and an upload endpoint the
// page posts its recording to (POST /lab/upload/<runId> -> var/lab/runs/<runId>/run.webm).
import { createWriteStream, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import type { DirectorMessage, PageMessage } from "../../contract.js";
import { isFiniteNumber, isRecord, parseJson } from "../json.js";
import { PAGE_DIR, REPO_ROOT, runDir, WEB_PUBLIC } from "../paths.js";

export interface StageServer {
  /** The page URL with these query parameters (the WebSocket port is added). */
  pageUrl(params: Record<string, string>): string;
  /** Queued until the page connects. */
  send(message: DirectorMessage): void;
  onMessage(listener: (message: PageMessage) => void): void;
  /** Resolves with the file once the page has uploaded `runId`'s recording. */
  awaitUpload(runId: string, file: string): Promise<string>;
  close(): Promise<void>;
}

export function parsePageMessage(value: unknown): PageMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case "ready":
      return typeof value.renderBackend === "string" ? { type: "ready", renderBackend: value.renderBackend } : undefined;
    case "frameStats":
      return Array.isArray(value.fps) && isFiniteNumber(value.dropped)
        ? { type: "frameStats", fps: value.fps.filter(isFiniteNumber), dropped: value.dropped }
        : undefined;
    case "audioStarted":
      return typeof value.id === "string" && isFiniteNumber(value.atMs) ? { type: "audioStarted", id: value.id, atMs: value.atMs } : undefined;
    case "error":
      return typeof value.message === "string" ? { type: "error", message: value.message } : undefined;
    default:
      return undefined;
  }
}

type Waiter = { file: string; resolve: (path: string) => void; reject: (e: Error) => void };

function uploadPlugin(waiters: Map<string, Waiter>): Plugin {
  return {
    name: "lab-upload",
    configureServer(server) {
      server.middlewares.use("/lab/upload/", (req: IncomingMessage, res: ServerResponse) => {
        const runId = decodeURIComponent((req.url ?? "").replace(/^\//, "").split("?")[0] ?? "");
        const waiter = waiters.get(runId);
        if (req.method !== "POST" || waiter === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const dir = runDir(runId);
        mkdirSync(dir, { recursive: true });
        const path = join(dir, waiter.file);
        pipeline(req, createWriteStream(path))
          .then(() => {
            res.statusCode = 204;
            res.end();
            waiters.delete(runId);
            waiter.resolve(path);
          })
          .catch((error: unknown) => {
            res.statusCode = 500;
            res.end();
            waiter.reject(new Error(`recording upload failed: ${error instanceof Error ? error.message : String(error)}`));
          });
      });
    },
  };
}

export async function openStage(log: (line: string) => void): Promise<StageServer> {
  const waiters = new Map<string, Waiter>();
  const vite: ViteDevServer = await createServer({
    configFile: false,
    root: PAGE_DIR,
    publicDir: WEB_PUBLIC,
    logLevel: "warn",
    clearScreen: false,
    plugins: [uploadPlugin(waiters)],
    server: { host: "127.0.0.1", port: 4380, strictPort: false, fs: { allow: [REPO_ROOT] } },
  });
  await vite.listen();
  const base = vite.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("The stage server did not report a URL.");

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const address = wss.address();
  const wsPort = typeof address === "object" && address !== null ? address.port : 0;
  const listeners: ((m: PageMessage) => void)[] = [];
  const queue: string[] = [];
  let socket: WebSocket | undefined;
  wss.on("connection", (ws) => {
    if (socket !== undefined) log("stage: a second page connected; it replaces the first.");
    socket = ws;
    for (const text of queue.splice(0)) ws.send(text);
    ws.on("message", (data) => {
      const message = parsePageMessage(parseJson(String(data)));
      if (message === undefined) return;
      for (const l of listeners) l(message);
    });
  });

  return {
    pageUrl(params) {
      const url = new URL(base);
      for (const [k, v] of Object.entries({ ...params, ws: String(wsPort) })) url.searchParams.set(k, v);
      return url.toString();
    },
    send(message) {
      const text = JSON.stringify(message);
      if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(text);
      else queue.push(text);
    },
    onMessage(listener) {
      listeners.push(listener);
    },
    awaitUpload(runId, file) {
      return new Promise<string>((resolve, reject) => waiters.set(runId, { file, resolve, reject }));
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await vite.close();
    },
  };
}
