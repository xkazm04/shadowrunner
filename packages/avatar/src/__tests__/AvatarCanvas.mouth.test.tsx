// @vitest-environment happy-dom
// <AvatarCanvas mouth level> (perfection-pass task 4, requirement 4.2, 4.4, 4.5): a clip's track
// on its clock reaches the frame body as its `mouth` input every frame; a drawn or warp mouth takes
// the shapes, a rig without one keeps the level drive; `level` wins over the audio tap; reduced
// motion hands one soft speaking shape. The frame body is the real one, wrapped to record.
import { cleanup, render } from "@testing-library/react";
import { defaultLook, type Look, type Rig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mouthMode } from "../mouth/anchor.js";
import { mixSpans, JAW_LEAD_MS } from "../mouth/track.js";
import type { FrameBodyInputs, FrameOutput } from "../player/frame.js";
import { AvatarCanvas, type AvatarCanvasProps } from "../react/AvatarCanvas.js";
import type { MouthTrack } from "../speech/analyse.js";
import { createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const seen = vi.hoisted(() => ({ inputs: [] as FrameBodyInputs[], outputs: [] as FrameOutput[] }));

vi.mock("../player/frame.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../player/frame.js")>();
  return {
    ...real,
    createFrameBody: (...args: Parameters<typeof real.createFrameBody>) => {
      const body = real.createFrameBody(...args);
      return (inputs: FrameBodyInputs) => {
        const out = body(inputs);
        seen.inputs.push(inputs);
        seen.outputs.push(out);
        return out;
      };
    },
  };
});

const bare = malakorRig();
const drawn: Rig = { ...bare, mouth: { cx: 512, lineY: 600, width: 120, render: "drawn" } };
const assets = fakeAssets(bare);
const look: Look = defaultLook(bare);

/** Open wide from 0.1 s to 0.3 s of a 0.5 s clip. */
const track: MouthTrack = { durationS: 0.5, at: (t) => mixSpans([{ shape: "openWide", startMs: 100, endMs: 300 }], t * 1000) };

let frames: Map<number, FrameRequestCallback>;
let reduce: boolean;

function tick(now: number): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

beforeEach(() => {
  const gl = createGlStub();
  frames = new Map();
  reduce = false;
  seen.inputs.length = 0;
  seen.outputs.length = 0;
  let id = 1;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => (kind === "webgl2" ? gl.gl : null)) as HTMLCanvasElement["getContext"]);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(id, callback);
    return id++;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => frames.delete(handle));
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = new window.EventTarget() as MediaQueryList;
    Object.defineProperty(list, "matches", { get: () => reduce && query.includes("reduce") });
    return list;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = (props: Partial<AvatarCanvasProps>) => render(<AvatarCanvas rig={drawn} look={look} assets={assets} {...props} />);

describe("<AvatarCanvas mouth>", () => {
  it("hands the frame body the track at the clip's time, the jaw JAW_LEAD_MS ahead", () => {
    expect(mouthMode(drawn.mouth)).toBe("drawn");
    let clipT = 0.2;
    mount({ mouth: { track, clock: () => clipT } });
    tick(0);
    const input = seen.inputs.at(-1)?.mouth;
    expect(input?.shapes).toEqual(track.at(0.2));
    expect(input?.jaw).toEqual(track.at(0.2 + JAW_LEAD_MS / 1000));
    // The drawn mouth is open wide (the shapes reached it), and the jaw opened for it.
    expect(seen.outputs.at(-1)?.clock.mouth?.params.open ?? 0).toBeGreaterThan(0.9);
    clipT = 0.45;
    tick(16);
    expect(seen.inputs.at(-1)?.mouth?.shapes.rest).toBe(1);
  });

  it("sends nothing without a track: the level drive stays (and a rig without a mouth ignores one)", () => {
    const { rerender } = mount({});
    tick(0);
    expect(seen.inputs.at(-1)).not.toHaveProperty("mouth");
    rerender(<AvatarCanvas rig={bare} look={look} assets={assets} mouth={{ track, clock: () => 0.2 }} level={() => 0.6} />);
    tick(16);
    expect(mouthMode(bare.mouth)).toBeUndefined();
    expect(seen.outputs.at(-1)?.clock.mouth).toBeUndefined();
  });

  it("reads `level` every frame instead of an audio tap", () => {
    let level = 0.7;
    mount({ level: () => level });
    tick(0);
    expect(seen.inputs.at(-1)?.level).toBe(0.7);
    level = 0.1;
    tick(16);
    expect(seen.inputs.at(-1)?.level).toBe(0.1);
  });

  it("under reduced motion hands one soft half-open shape while the clip plays, never the track's shapes", () => {
    reduce = true;
    mount({ mouth: { track, clock: () => 0.2 } });
    for (let k = 0; k < 40; k += 1) tick(k * 16);
    const shapes = seen.inputs.at(-1)?.mouth?.shapes;
    expect(shapes?.openWide).toBe(0);
    expect(shapes?.openMid ?? 0).toBeGreaterThan(0.45);
    expect(shapes?.openMid ?? 1).toBeLessThanOrEqual(0.5);
  });
});
