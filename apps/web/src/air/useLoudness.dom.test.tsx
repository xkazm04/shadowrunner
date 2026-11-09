// @vitest-environment happy-dom
// The stage's audio graph (perfection-pass 4.4): one AudioContext and one analyser tap per <audio>,
// read by the face (`level`) and the tally (`jawOpen`) alike; StrictMode's double effect keeps the
// context, a real unmount closes it. The AudioContext is a fake that counts.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../app/testDom";
import { useLoudness, type Loudness } from "./useLoudness";

interface Counts {
  contexts: number;
  analysers: number;
  liveTaps: number;
  closed: number;
}

function fakeContextFactory(counts: Counts) {
  return () => {
    counts.contexts += 1;
    const context = {
      state: "running" as AudioContextState,
      destination: {},
      close: async () => {
        counts.closed += 1;
      },
      resume: async () => undefined,
      createAnalyser: () => {
        counts.analysers += 1;
        return {
          fftSize: 2048,
          // A steady RMS of 0.2: speechLevel (0.2 - 0.02) * 4 = 0.72.
          getFloatTimeDomainData: (out: Float32Array) => out.fill(0.2),
        };
      },
      createMediaElementSource: () => ({
        context,
        connect: (target: unknown) => {
          if (target !== context.destination) counts.liveTaps += 1;
        },
        disconnect: (target?: unknown) => {
          if (target !== undefined) counts.liveTaps -= 1;
        },
      }),
    };
    return context as object as AudioContext;
  };
}

let m: Mounted | undefined;
let counts: Counts;

beforeEach(() => {
  vi.useFakeTimers();
  counts = { contexts: 0, analysers: 0, liveTaps: 0, closed: 0 };
});

afterEach(async () => {
  await m?.unmount();
  m = undefined;
  vi.useRealTimers();
});

describe("useLoudness", () => {
  it("one context and one live tap per element; the face's level and the tally read it", async () => {
    const audio = document.createElement("audio");
    const factory = fakeContextFactory(counts);
    let loud: Loudness | undefined;
    const Probe = () => {
      loud = useLoudness(audio, factory);
      return null;
    };
    m = await mount(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await elapse(10);
    expect(counts.contexts).toBe(1);
    expect(counts.liveTaps).toBe(1);
    expect(counts.closed).toBe(0);
    expect(loud?.level()).toBeCloseTo(0.72, 6);
    loud?.jawOpen(0);
    expect(loud?.jawOpen(50) ?? 0).toBeGreaterThan(0.5);
    expect(counts.liveTaps).toBe(1);
  });

  it("closes the context after unmount", async () => {
    const audio = document.createElement("audio");
    const factory = fakeContextFactory(counts);
    const Probe = () => {
      useLoudness(audio, factory);
      return null;
    };
    m = await mount(<Probe />);
    await m.unmount();
    m = undefined;
    expect(counts.liveTaps).toBe(0);
    await elapse(1);
    expect(counts.closed).toBe(1);
  });
});
