// attachAudio(MediaStream) (spec avatar-reach, design "Player core"): a fake context records the
// stream source; no Web Audio in node.
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachAudio } from "../audio/level.js";

class FakeNode {
  readonly connections: object[] = [];
  disconnectedAll = false;
  connect(target: object): object {
    this.connections.push(target);
    return target;
  }
  disconnect(target?: object): void {
    if (target === undefined) {
      this.connections.length = 0;
      this.disconnectedAll = true;
      return;
    }
    const i = this.connections.indexOf(target);
    if (i >= 0) this.connections.splice(i, 1);
  }
}

class FakeContext {
  static made: FakeContext[] = [];
  readonly destination = { name: "destination" };
  readonly streams: [MediaStream, FakeNode][] = [];
  closed = 0;
  level = 0.27;
  createAnalyser() {
    const analyser = Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(this.level) });
    return analyser;
  }
  createMediaStreamSource(stream: MediaStream): FakeNode {
    const node = new FakeNode();
    this.streams.push([stream, node]);
    return node;
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

const fakeStream = (): MediaStream => ({ id: "mic", getAudioTracks: () => [], getTracks: () => [] }) as object as MediaStream;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeContext.made = [];
});

describe("attachAudio(MediaStream)", () => {
  it("wraps the stream with createMediaStreamSource in options.context, taps it, never routes it to the speakers", () => {
    const context = new FakeContext();
    const stream = fakeStream();
    const tap = attachAudio(stream, { context: context as object as AudioContext });
    expect(context.streams).toHaveLength(1);
    const [wrapped, node] = context.streams[0] ?? [];
    expect(wrapped).toBe(stream);
    expect(node?.connections).toHaveLength(1);
    expect(node?.connections).not.toContain(context.destination);
    expect(tap.level()).toBeCloseTo(1, 9);
    tap.detach();
    expect(node?.connections).toHaveLength(0);
    expect(node?.disconnectedAll).toBe(true);
    expect(context.closed).toBe(0); // the caller's context stays open
    expect(tap.level()).toBe(0);
  });

  it("makes its own AudioContext when none is given, and closes it on detach (once)", () => {
    vi.stubGlobal(
      "AudioContext",
      class extends FakeContext {
        constructor() {
          super();
          FakeContext.made.push(this);
        }
      },
    );
    const tap = attachAudio(fakeStream());
    expect(FakeContext.made).toHaveLength(1);
    expect(FakeContext.made[0]?.streams).toHaveLength(1);
    tap.detach();
    tap.detach();
    expect(FakeContext.made[0]?.closed).toBe(1);
  });
});
