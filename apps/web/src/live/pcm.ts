// Puppet mode's audio path (spec flashhead-live, task 3.3): the microphone's float samples at the
// context's rate, resampled to 16 kHz and cut into ~40 ms PCM16 frames for the 0x10 message. Pure
// (the resampler keeps its phase across pushes), so it is unit-tested with synthetic tones.
import { toPcm16 } from "./protocol";

export const MIC_RATE = 16000;
/** 40 ms at 16 kHz: one video frame of audio per message. */
export const MIC_CHUNK = 640;

export interface Chunker {
  /** Samples at the input rate in; whole 16 kHz PCM16 chunks out. */
  push(samples: Float32Array): Int16Array[];
}

/**
 * Linear-interpolation resampler plus a fixed-size cutter. Downsampling first takes a running
 * mean over each output step (a box filter), which keeps most aliasing out for speech.
 */
export function createChunker(inputRate: number, outputRate = MIC_RATE, chunk = MIC_CHUNK): Chunker {
  const step = inputRate / outputRate;
  const box = Math.max(1, Math.floor(step));
  let pending = new Float32Array(0);
  let pos = 0;
  let out = new Float32Array(chunk);
  let filled = 0;
  let history: number[] = [];

  return {
    push(samples) {
      // Box-filter the new samples against the tail of the previous push.
      const filtered = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        history.push(samples[i] ?? 0);
        if (history.length > box) history.shift();
        let sum = 0;
        for (const h of history) sum += h;
        filtered[i] = sum / history.length;
      }
      const joined = new Float32Array(pending.length + filtered.length);
      joined.set(pending);
      joined.set(filtered, pending.length);
      const chunks: Int16Array[] = [];
      while (pos + 1 < joined.length) {
        const i = Math.floor(pos);
        const frac = pos - i;
        const a = joined[i] ?? 0;
        const b = joined[i + 1] ?? 0;
        out[filled] = a + (b - a) * frac;
        filled += 1;
        if (filled === chunk) {
          chunks.push(toPcm16(out));
          out = new Float32Array(chunk);
          filled = 0;
        }
        pos += step;
      }
      const keep = Math.min(Math.floor(pos), joined.length);
      pending = joined.slice(keep);
      pos -= keep;
      history = history.slice(-box);
      return chunks;
    },
  };
}

/** The AudioWorklet that hands the main thread every input block (channel 0), copied. */
export const CAPTURE_WORKLET = `
class SrLiveCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("sr-live-capture", SrLiveCapture);
`;

/** The RMS of a block, 0..1 (the puppet tab's level meter). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
