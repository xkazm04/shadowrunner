// The overlay's microphone (spec avatar-reach 3.3): asks on load, attaches the stream with its own
// context, and falls back to a click on a refusal or a suspended context; cleanup stops the tracks.
import { describe, expect, it, vi } from "vitest";
import { CLICK_TO_START, createMic, MIC_MISSING, MIC_REFUSED, MIC_UNAVAILABLE, type MicEnv, type MicState } from "./mic";

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as object as MediaStream, track };
}

function fakeContext(state: AudioContextState) {
  const context = {
    state,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => undefined),
  };
  return context;
}

const named = (name: string) => Object.assign(new Error(name), { name });

function setup(env: Partial<MicEnv> & { context?: ReturnType<typeof fakeContext> }) {
  const context = env.context ?? fakeContext("running");
  const player = { attachAudio: vi.fn() };
  const states: MicState[] = [];
  const mic = createMic(
    player,
    { getUserMedia: env.getUserMedia, createContext: () => context as object as AudioContext },
    (state) => states.push(state),
  );
  return { mic, player, states, context };
}

describe("createMic", () => {
  it("attaches the stream with its own context and runs", async () => {
    const { stream } = fakeStream();
    const { mic, player, states, context } = setup({ getUserMedia: async () => stream });
    await mic.start(false);
    expect(player.attachAudio).toHaveBeenCalledWith(stream, { context });
    expect(states.at(-1)).toEqual({ kind: "running" });
  });

  it("asks for a click when the context starts suspended, then resumes on it", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    const { mic, player, states, context } = setup({ getUserMedia, context: fakeContext("suspended") });
    await mic.start(false);
    expect(states.at(-1)).toEqual({ kind: "needs-click", reason: CLICK_TO_START });
    expect(player.attachAudio).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();

    await mic.start(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(player.attachAudio).toHaveBeenCalledWith(stream, { context });
    expect(states.at(-1)).toEqual({ kind: "running" });
  });

  it("offers a click after a refusal, and asks again on it", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockRejectedValueOnce(named("NotAllowedError")).mockResolvedValueOnce(stream);
    const { mic, player, states } = setup({ getUserMedia });
    await mic.start(false);
    expect(states.at(-1)).toEqual({ kind: "needs-click", reason: MIC_REFUSED });
    await mic.start(true);
    expect(player.attachAudio).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ kind: "running" });
  });

  it("says why when a click cannot help", async () => {
    const missing = setup({ getUserMedia: () => Promise.reject(named("NotFoundError")) });
    await missing.mic.start(false);
    expect(missing.states.at(-1)).toEqual({ kind: "failed", reason: MIC_MISSING });

    const none = setup({ getUserMedia: undefined });
    await none.mic.start(false);
    expect(none.states.at(-1)).toEqual({ kind: "failed", reason: MIC_UNAVAILABLE });
  });

  it("detaches, stops the tracks and closes the context on dispose; a late stream is stopped", async () => {
    const { stream, track } = fakeStream();
    const { mic, player, context } = setup({ getUserMedia: async () => stream });
    await mic.start(false);
    mic.dispose();
    expect(player.attachAudio).toHaveBeenLastCalledWith(undefined);
    expect(track.stop).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();

    const late = fakeStream();
    let grant: (s: MediaStream) => void = () => undefined;
    const pending = setup({ getUserMedia: () => new Promise<MediaStream>((r) => (grant = r)) });
    const started = pending.mic.start(false);
    pending.mic.dispose();
    grant(late.stream);
    await started;
    expect(late.track.stop).toHaveBeenCalled();
    expect(pending.player.attachAudio).not.toHaveBeenCalled();
  });
});
