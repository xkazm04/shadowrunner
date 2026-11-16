// One `fhl/1` connection (spec flashhead-live, task 3): opens the socket, says hello with its role,
// hands every server message and media frame on typed, and reconnects with a capped backoff when
// the server goes away. The WebSocket class and the timers are injected, so the reconnect rules
// are unit-tested without a server.
import { decodeMedia, encodeMessage, parseServerMessage, type ClientMessage, type Media, type Role, type ServerMessage } from "./protocol";

/** `connecting` until the first open; `down` between attempts; `refused` when the origin check said no (4403). */
export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "down"; retryInMs: number; attempts: number }
  | { kind: "refused" }
  | { kind: "closed" };

export interface ClientHandlers {
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage) => void;
  onMedia?: (media: Media) => void;
}

/** The slice of the browser's WebSocket the client uses. */
export interface SocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface Timers {
  set: (fn: () => void, ms: number) => number;
  clear: (handle: number) => void;
}

export interface ClientOptions extends ClientHandlers {
  url: string;
  role: Role;
  socket?: SocketFactory;
  timers?: Timers;
}

export interface LiveClient {
  send(message: ClientMessage): boolean;
  sendBinary(data: ArrayBuffer): boolean;
  /** True while the socket is open. */
  readonly open: boolean;
  close(): void;
}

export const REFUSED_CODE = 4403;
const OPEN = 1;
export const BACKOFF_MS = { first: 500, max: 8000 } as const;

/** The wait before attempt `n` (1-based) after a drop: 500 ms doubling, capped at 8 s. */
export const backoffMs = (attempt: number): number => Math.min(BACKOFF_MS.max, BACKOFF_MS.first * 2 ** Math.max(0, attempt - 1));

const browserSocket: SocketFactory = (url) => new WebSocket(url);
const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle),
};

export function connectLive(options: ClientOptions): LiveClient {
  const { url, role, socket = browserSocket, timers = browserTimers } = options;
  let ws: SocketLike | undefined;
  let attempts = 0;
  let retry: number | undefined;
  let closed = false;

  const status = (next: ConnectionStatus) => {
    if (!closed || next.kind === "closed") options.onStatus?.(next);
  };

  function attach(): void {
    let current: SocketLike;
    try {
      current = socket(url);
    } catch {
      // A malformed URL never connects: treat it as down so the empty state shows.
      return scheduleRetry();
    }
    ws = current;
    current.binaryType = "arraybuffer";
    current.onopen = () => {
      attempts = 0;
      current.send(encodeMessage({ type: "hello", role }));
      status({ kind: "open" });
    };
    current.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === "string") {
        const message = parseServerMessage(data);
        if (message !== undefined) options.onMessage?.(message);
      } else if (data instanceof ArrayBuffer) {
        const media = decodeMedia(data);
        if (media !== undefined) options.onMedia?.(media);
      }
    };
    current.onerror = () => undefined;
    current.onclose = (event: CloseEvent) => {
      if (ws !== current) return;
      ws = undefined;
      if (closed) return;
      if (event.code === REFUSED_CODE) return status({ kind: "refused" });
      scheduleRetry();
    };
  }

  function scheduleRetry(): void {
    if (closed) return;
    attempts += 1;
    const wait = backoffMs(attempts);
    status({ kind: "down", retryInMs: wait, attempts });
    retry = timers.set(() => {
      retry = undefined;
      if (!closed) attach();
    }, wait);
  }

  status({ kind: "connecting" });
  attach();

  const ready = (): SocketLike | undefined => (ws !== undefined && ws.readyState === OPEN ? ws : undefined);

  return {
    send(message) {
      const open = ready();
      if (open === undefined) return false;
      open.send(encodeMessage(message));
      return true;
    },
    sendBinary(data) {
      const open = ready();
      if (open === undefined) return false;
      open.send(data);
      return true;
    },
    get open() {
      return ready() !== undefined;
    },
    close() {
      if (closed) return;
      closed = true;
      if (retry !== undefined) timers.clear(retry);
      const current = ws;
      ws = undefined;
      current?.close(1000);
      status({ kind: "closed" });
    },
  };
}
