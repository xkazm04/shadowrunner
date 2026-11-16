import { describe, expect, it } from "vitest";
import { backoffMs, connectLive, REFUSED_CODE, type ConnectionStatus, type SocketLike, type Timers } from "./client";
import { encodeVideo, type Media, type ServerMessage } from "./protocol";

class FakeSocket implements SocketLike {
  binaryType: BinaryType = "blob";
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code }));
  }
  receive(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set: (fn) => {
      next += 1;
      pending.set(next, fn);
      return next;
    },
    clear: (h) => pending.delete(h),
  };
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  const media: Media[] = [];
  const client = connectLive({
    url: "ws://127.0.0.1:8790/live",
    role: "control",
    socket: (url) => {
      const s = new FakeSocket();
      expect(url).toBe("ws://127.0.0.1:8790/live");
      sockets.push(s);
      return s;
    },
    timers,
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
    onMedia: (m) => media.push(m),
  });
  const fire = () => {
    const [[h, fn] = []] = [...pending];
    if (h === undefined || fn === undefined) throw new Error("no timer pending");
    pending.delete(h);
    fn();
  };
  const last = () => {
    const s = sockets.at(-1);
    if (s === undefined) throw new Error("no socket");
    return s;
  };
  return { client, sockets, pending, statuses, messages, media, fire, last };
}

describe("connectLive", () => {
  it("says hello with its role on open and binary-types the socket", () => {
    const h = harness();
    expect(h.last().binaryType).toBe("arraybuffer");
    expect(h.client.send({ type: "stop" })).toBe(false);
    h.last().open();
    expect(h.last().sent).toEqual([JSON.stringify({ type: "hello", role: "control" })]);
    expect(h.statuses.map((s) => s.kind)).toEqual(["connecting", "open"]);
    expect(h.client.send({ type: "stop" })).toBe(true);
    expect(h.client.sendBinary(new ArrayBuffer(2))).toBe(true);
    expect(h.last().sent).toHaveLength(3);
  });

  it("hands on typed messages and decoded media, and ignores junk", () => {
    const h = harness();
    h.last().open();
    h.last().receive(JSON.stringify({ type: "event", kind: "line-end", id: "a", text: null, atMs: 10 }));
    h.last().receive("junk");
    h.last().receive(encodeVideo(40, 512, 512, new Uint8Array([1])));
    h.last().receive(new ArrayBuffer(0));
    expect(h.messages).toEqual([{ type: "event", kind: "line-end", id: "a", text: null, atMs: 10 }]);
    expect(h.media).toHaveLength(1);
  });

  it("reconnects with a doubling, capped backoff that resets once open", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    const h = harness();
    h.last().drop();
    expect(h.statuses.at(-1)).toEqual({ kind: "down", retryInMs: 500, attempts: 1 });
    h.fire();
    expect(h.sockets).toHaveLength(2);
    h.last().drop();
    expect(h.statuses.at(-1)).toEqual({ kind: "down", retryInMs: 1000, attempts: 2 });
    h.fire();
    h.last().open();
    h.last().drop();
    expect(h.statuses.at(-1)).toEqual({ kind: "down", retryInMs: 500, attempts: 1 });
  });

  it("stops on a refused origin (4403) and on close", () => {
    const h = harness();
    h.last().drop(REFUSED_CODE);
    expect(h.statuses.at(-1)).toEqual({ kind: "refused" });
    expect(h.pending.size).toBe(0);

    const g = harness();
    g.last().drop();
    expect(g.pending.size).toBe(1);
    g.client.close();
    expect(g.pending.size).toBe(0);
    expect(g.statuses.at(-1)).toEqual({ kind: "closed" });
    expect(g.client.open).toBe(false);
  });
});
