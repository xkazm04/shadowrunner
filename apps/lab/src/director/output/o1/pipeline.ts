// O1's live path in Node: page chunks -> publisher ffmpeg (stdin) -> RTMP -> sink ffmpeg -> segment.
// A sink records one RTMP connection, so when the publisher dies the sink closes its segment; the
// pipeline then opens a new sink + publisher, feeds the new publisher the init segment and the
// stream from the next Cluster on, counts the reconnect and reports a mark. Each segment remembers
// the Cluster timecode it starts at, so the segments can be joined on the recording's own clock.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { clusterTimecode, findCluster, InitSegment } from "./ebml.js";
import { freePort, publishArgs, settle, sinkArgs, startProc, type Proc, type PublishSettings } from "./ffmpeg.js";

export interface Segment {
  file: string;
  /** Recorder time (ms, Matroska Cluster timecode) of the segment's first byte. */
  startMs: number;
}

export interface PipelineOptions {
  ffmpeg: string;
  settings: PublishSettings;
  dir: string;
  log(line: string): void;
  mark(name: string): void;
}

/** Wait between starting a sink and connecting its publisher. */
const SINK_WARMUP_MS = 400;
/** Publisher attempts per segment that never reached the sink (connect races), before giving up. */
const CONNECT_ATTEMPTS = 6;
/** Bytes kept while waiting for the next Cluster after a restart. */
const JOIN_LIMIT = 64 * 1024 * 1024;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RtmpPipeline {
  readonly segments: Segment[] = [];
  reconnects = 0;
  readonly #o: PipelineOptions;
  readonly #init = new InitSegment();
  #sink: Proc | undefined;
  #publisher: Proc | undefined;
  #state: "idle" | "live" | "joining" | "restarting" | "closed" = "idle";
  #pending: Buffer = Buffer.alloc(0);
  #restart: Promise<void> = Promise.resolve();

  constructor(options: PipelineOptions) {
    this.#o = options;
  }

  get publisherPid(): number | undefined {
    return this.#publisher?.child.pid;
  }

  async open(): Promise<void> {
    await this.#openSegment();
    this.#state = "live";
  }

  /** One chunk from the page, in order. */
  write(chunk: Buffer): void {
    if (this.#state === "closed" || this.#state === "idle") return;
    this.#init.push(chunk);
    if (this.#state === "live") {
      this.#feed(chunk);
      return;
    }
    // joining or restarting: keep bytes until a Cluster boundary arrives on a live publisher.
    this.#pending = Buffer.concat([this.#pending, chunk]);
    if (this.#pending.length > JOIN_LIMIT) this.#pending = this.#pending.subarray(this.#pending.length - JOIN_LIMIT);
    if (this.#state === "joining") this.#tryJoin();
  }

  #feed(bytes: Uint8Array): void {
    const stdin = this.#publisher?.child.stdin;
    if (stdin === undefined || stdin === null || stdin.destroyed) return;
    stdin.write(bytes, () => undefined);
  }

  #tryJoin(): void {
    const header = this.#init.header;
    if (header === undefined) return;
    const at = findCluster(this.#pending);
    if (at < 0) {
      // Keep only a tail that could hold the start of a Cluster split across chunks.
      if (this.#pending.length > 16) this.#pending = this.#pending.subarray(this.#pending.length - 16);
      return;
    }
    const tc = clusterTimecode(this.#pending, at);
    if (tc === undefined) return; // wait for the Timecode bytes
    const seg = this.segments.at(-1);
    if (seg !== undefined) seg.startMs = tc;
    const tail = this.#pending.subarray(at);
    this.#pending = Buffer.alloc(0);
    this.#state = "live";
    this.#feed(header);
    this.#feed(tail);
    this.#o.log(`O1: publisher rejoined at recorder ${tc} ms.`);
  }

  /** A method, not an inline test: close() can run while a restart awaits. */
  #isClosed(): boolean {
    return this.#state === "closed";
  }

  async #openSegment(): Promise<void> {
    const file = join(this.#o.dir, `run.part${this.segments.length + 1}.flv`);
    const port = await freePort();
    this.#sink = startProc(this.#o.ffmpeg, sinkArgs(port, file), "ignore");
    this.segments.push({ file, startMs: 0 });
    await delay(SINK_WARMUP_MS);
    this.#startPublisher(port, file, 1);
  }

  #startPublisher(port: number, file: string, attempt: number): void {
    const started = performance.now();
    const proc = startProc(this.#o.ffmpeg, publishArgs(port, this.#o.settings), "pipe");
    this.#publisher = proc;
    this.#o.log(`O1: publisher pid ${proc.child.pid ?? "?"} -> ${port} (segment ${this.segments.length}, attempt ${attempt}).`);
    proc.child.stdin?.on("error", () => undefined);
    void proc.exited.then((code) => {
      if (this.#publisher !== proc || this.#state === "closed") return;
      const reachedSink = existsSync(file) && statSync(file).size > 0;
      if (!reachedSink && attempt < CONNECT_ATTEMPTS && performance.now() - started < 5000) {
        this.#o.log(`O1: publisher could not connect (attempt ${attempt}, exit ${code}): ${proc.tail()}`);
        void delay(300).then(() => {
          if (this.#state !== "closed") this.#startPublisher(port, file, attempt + 1);
        });
        return;
      }
      this.#restart = this.#recover(code, proc.tail());
    });
  }

  async #recover(code: number | null, tail: string): Promise<void> {
    this.reconnects += 1;
    this.#state = "restarting";
    this.#o.log(`O1: publisher died (exit ${code}${tail === "" ? "" : `: ${tail}`}); restarting (reconnect ${this.reconnects}).`);
    this.#o.mark(`o1:publisher-died:${code ?? "signal"}`);
    if (this.#sink !== undefined) await settle(this.#sink, 10_000);
    if (this.#isClosed()) return;
    await this.#openSegment();
    if (this.#isClosed()) return;
    this.#state = "joining";
    this.#o.mark(`o1:reconnect:${this.reconnects}`);
    this.#tryJoin();
  }

  /** Ends the stream: closes the publisher's stdin, waits for both processes, returns the segments. */
  async close(): Promise<Segment[]> {
    await this.#restart;
    this.#state = "closed";
    const publisher = this.#publisher;
    if (publisher !== undefined) {
      publisher.child.stdin?.end();
      const code = await settle(publisher, 60_000);
      if (code !== 0) this.#o.log(`O1: publisher ended with exit ${code}: ${publisher.tail()}`);
    }
    if (this.#sink !== undefined) {
      const code = await settle(this.#sink, 20_000);
      if (code !== 0) this.#o.log(`O1: sink ended with exit ${code}: ${this.#sink.tail()}`);
    }
    const first = this.segments[0];
    if (first !== undefined) first.startMs = this.#init.firstClusterMs ?? 0;
    return this.segments.filter((s) => existsSync(s.file) && statSync(s.file).size > 0);
  }
}
