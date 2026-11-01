// Audio level tap (task 2, req 4.1) against a fake AudioContext: no Web Audio in node.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { attachAudio, LEVEL_FFT_SIZE, rms, SPEECH_FLOOR, SPEECH_GAIN } from "../audio/level.js";

/** A fake node that records its connections. */
class FakeNode {
  readonly connections: object[] = [];
  readonly context: FakeContext;
  constructor(context: FakeContext) {
    this.context = context;
  }
  connect(target: object): object {
    this.connections.push(target);
    return target;
  }
  disconnect(target: object): void {
    const i = this.connections.indexOf(target);
    if (i >= 0) this.connections.splice(i, 1);
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  private readonly signal: () => number[];
  constructor(context: FakeContext, signal: () => number[]) {
    super(context);
    this.signal = signal;
  }
  getFloatTimeDomainData(array: Float32Array): void {
    const values = this.signal();
    for (let i = 0; i < array.length; i += 1) array[i] = values[i % values.length] ?? 0;
  }
}

class FakeContext {
  readonly destination = { name: "destination" };
  readonly analysers: FakeAnalyser[] = [];
  readonly elementSources: FakeNode[] = [];
  signal: number[] = [0];
  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser(this, () => this.signal);
    this.analysers.push(analyser);
    return analyser;
  }
  createMediaElementSource(): FakeNode {
    const node = new FakeNode(this);
    this.elementSources.push(node);
    return node;
  }
}

// Test doubles stand in for Web Audio types through `object` (node has no Web Audio).
const asNode = (node: FakeNode): AudioNode => node as object as AudioNode;
const asContext = (ctx: FakeContext): AudioContext => ctx as object as AudioContext;
const fakeElement = (): HTMLMediaElement => ({ tagName: "AUDIO" }) as object as HTMLMediaElement;

describe("rms", () => {
  it("is the root mean square, in [0, 1] for any samples", () => {
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5, 12);
    expect(rms([])).toBe(0);
    fc.assert(
      fc.property(fc.array(fc.double({ noNaN: false }), { maxLength: 64 }), (samples) => {
        const value = rms(samples);
        return value >= 0 && value <= 1;
      }),
    );
  });
});

describe("attachAudio", () => {
  it("taps an AudioNode in its own context through an AnalyserNode", () => {
    const ctx = new FakeContext();
    const source = new FakeNode(ctx);
    const tap = attachAudio(asNode(source));
    const analyser = ctx.analysers[0];
    expect(analyser?.fftSize).toBe(LEVEL_FFT_SIZE);
    expect(source.connections).toEqual([analyser]);
    ctx.signal = [0.1, -0.1];
    expect(tap.level()).toBeCloseTo((0.1 - SPEECH_FLOOR) * SPEECH_GAIN, 6);
    ctx.signal = [0];
    expect(tap.level()).toBe(0);
  });

  it("clamps a clipping signal to 1", () => {
    const ctx = new FakeContext();
    const tap = attachAudio(asNode(new FakeNode(ctx)));
    ctx.signal = [3, -3];
    expect(tap.level()).toBe(1);
  });

  it("detach disconnects only the analyser and reads 0 afterwards", () => {
    const ctx = new FakeContext();
    const source = new FakeNode(ctx);
    const other = { name: "speakers" };
    source.connect(other);
    const tap = attachAudio(asNode(source));
    ctx.signal = [0.5];
    tap.detach();
    tap.detach();
    expect(source.connections).toEqual([other]);
    expect(tap.level()).toBe(0);
  });

  it("wraps a media element once, keeps it audible, and reuses the wrapper", () => {
    const ctx = new FakeContext();
    const element = fakeElement();
    const first = attachAudio(element, { context: asContext(ctx) });
    const second = attachAudio(element, { context: asContext(new FakeContext()) });
    expect(ctx.elementSources).toHaveLength(1);
    const wrapper = ctx.elementSources[0];
    expect(wrapper?.connections[0]).toBe(ctx.destination);
    expect(wrapper?.connections).toHaveLength(3);
    first.detach();
    second.detach();
    expect(wrapper?.connections).toEqual([ctx.destination]);
  });
});
