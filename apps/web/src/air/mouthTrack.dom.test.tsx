// @vitest-environment happy-dom
// A clip's mouth track (perfection-pass task 4, requirement 4.3): decoded and analysed once per
// URL with the starter's words, undefined on any failure (the face keeps the loudness jaw), and
// followed by `useClipMouth` from whatever the <audio> element plays. Fetch and decode are fakes
// (a synthetic clip at 16 kHz); no network.
import type { ClipMouth } from "@sr/avatar";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../app/testDom";
import { clearClipTracks, DECODE_RATE, trackForClip, useClipMouth, type ClipDeps } from "./mouthTrack";

/** 0.3 s of a 150 Hz buzz between two silences: speech the analyser opens the mouth for. */
function buzz(): Float32Array {
  const n = DECODE_RATE;
  return Float32Array.from({ length: n }, (_, i) => (i > n * 0.35 && i < n * 0.65 ? 0.3 * Math.sign(Math.sin((2 * Math.PI * 150 * i) / DECODE_RATE)) : 0));
}

function fakeDeps(over: Partial<ClipDeps> = {}) {
  const fetched: string[] = [];
  const deps: ClipDeps = {
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    decode: async () => buzz(),
    ...over,
  };
  return { deps, fetched };
}

beforeEach(() => clearClipTracks());

describe("trackForClip", () => {
  it("analyses a clip once per URL: the first call (with the words) is the one every reader gets", async () => {
    const { deps, fetched } = fakeDeps();
    const first = trackForClip("/replay/a.wav", "Hello there", deps);
    const again = trackForClip(`${document.baseURI.replace(/\/[^/]*$/, "")}/replay/a.wav`, undefined, deps);
    expect(again).toBe(first);
    const track = await first;
    expect(fetched).toHaveLength(1);
    expect(track?.durationS).toBeCloseTo(1, 6);
    expect(track?.at(0.5).rest ?? 1).toBeLessThan(0.5);
    expect(track?.at(0.1).rest).toBe(1);
  });

  it("resolves undefined when the clip cannot be fetched, decoded or is empty (the loudness jaw stays)", async () => {
    const notFound = fakeDeps({ fetch: async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) });
    expect(await trackForClip("/missing.wav", undefined, notFound.deps)).toBeUndefined();
    const broken = fakeDeps({ decode: () => Promise.reject(new DOMException("bad", "EncodingError")) });
    expect(await trackForClip("/broken.wav", undefined, broken.deps)).toBeUndefined();
    const empty = fakeDeps({ decode: async () => new Float32Array(0) });
    expect(await trackForClip("/empty.wav", undefined, empty.deps)).toBeUndefined();
    const none = fakeDeps({ decode: async () => undefined });
    expect(await trackForClip(new Blob(["x"]), undefined, none.deps)).toBeUndefined();
  });
});

describe("useClipMouth", () => {
  let m: Mounted | undefined;
  afterEach(async () => {
    await m?.unmount();
    m = undefined;
  });

  it("follows the element's source: none, then the clip's track on its clock (NaN while paused)", async () => {
    const { deps } = fakeDeps();
    const audio = document.createElement("audio");
    let seen: ClipMouth | undefined;
    const Probe = () => {
      seen = useClipMouth(audio, deps);
      return null;
    };
    m = await mount(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(seen).toBeUndefined();
    audio.src = "/replay/b.wav";
    audio.dispatchEvent(new Event("loadstart"));
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.track.durationS).toBeCloseTo(1, 6);
    Object.defineProperty(audio, "paused", { configurable: true, get: () => true });
    expect(seen?.clock()).toBeNaN();
    Object.defineProperty(audio, "paused", { configurable: true, get: () => false });
    Object.defineProperty(audio, "currentTime", { configurable: true, get: () => 0.42 });
    expect(seen?.clock()).toBe(0.42);
    // A new source drops the old track at once.
    audio.src = "/replay/c.wav";
    const pending = trackForClip("/replay/c.wav", undefined, { ...deps, decode: () => new Promise<Float32Array | undefined>(() => undefined) });
    void pending;
    await m.rerender(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    audio.dispatchEvent(new Event("loadstart"));
    await vi.waitFor(() => expect(seen).toBeUndefined());
  });
});
