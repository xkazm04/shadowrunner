// Puppet mode's microphone (spec flashhead-live, task 3.3): getUserMedia -> AudioWorklet ->
// 16 kHz PCM16 -> 0x10 frames of 40 ms. The mic is captured, never played back (a muted gain keeps
// the worklet pulled). The browser is injected so the start/stop path is testable.
import { CAPTURE_WORKLET, createChunker, rms } from "./pcm";
import { encodeMic } from "./protocol";

export interface PuppetEnv {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  createContext: () => AudioContext;
}

export function browserPuppetEnv(): PuppetEnv {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    getUserMedia: devices?.getUserMedia === undefined ? undefined : (c) => devices.getUserMedia(c),
    createContext: () => new AudioContext(),
  };
}

export const PUPPET_UNAVAILABLE = "This page cannot reach a microphone here (it needs https or localhost).";
export const PUPPET_REFUSED = "The microphone was refused. Allow it in this site's settings and try again.";
export const PUPPET_FAILED = "The microphone could not start.";

export interface Puppet {
  stop(): void;
}

export type PuppetStart = { ok: true; puppet: Puppet } | { ok: false; error: string };

export async function startPuppet(
  send: (frame: ArrayBuffer) => void,
  onLevel: (level: number) => void,
  env: PuppetEnv = browserPuppetEnv(),
): Promise<PuppetStart> {
  if (env.getUserMedia === undefined) return { ok: false, error: PUPPET_UNAVAILABLE };
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
    return { ok: false, error: name === "NotAllowedError" || name === "SecurityError" ? PUPPET_REFUSED : PUPPET_FAILED };
  }
  const context = env.createContext();
  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
  try {
    if (context.state === "suspended") await context.resume();
    await context.audioWorklet.addModule(url);
  } catch {
    stopTracks();
    void context.close().catch(() => undefined);
    return { ok: false, error: PUPPET_FAILED };
  } finally {
    URL.revokeObjectURL(url);
  }
  const input = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "sr-live-capture");
  const mute = context.createGain();
  mute.gain.value = 0;
  input.connect(node);
  node.connect(mute);
  mute.connect(context.destination);
  const chunker = createChunker(context.sampleRate);
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    onLevel(rms(event.data));
    for (const chunk of chunker.push(event.data)) send(encodeMic(chunk));
  };
  let stopped = false;
  return {
    ok: true,
    puppet: {
      stop() {
        if (stopped) return;
        stopped = true;
        node.port.onmessage = null;
        input.disconnect();
        node.disconnect();
        mute.disconnect();
        stopTracks();
        void context.close().catch(() => undefined);
        onLevel(0);
      },
    },
  };
}
