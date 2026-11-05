// 16-bit PCM mono WAV: the run's audio/<id>.wav files, written live and read back by replay.

const HEADER_BYTES = 44;

export function encodeWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** The PCM and rate of a WAV this module wrote (or any 16-bit mono PCM WAV); throws otherwise. */
export function decodeWav(wav: Buffer): { sampleRate: number; pcm: Buffer } {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let at = 12;
  let sampleRate: number | undefined;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      if (wav.readUInt16LE(body) !== 1 || wav.readUInt16LE(body + 2) !== 1 || wav.readUInt16LE(body + 14) !== 16) {
        throw new Error("only 16-bit mono PCM WAV is supported");
      }
      sampleRate = wav.readUInt32LE(body + 4);
    } else if (id === "data") {
      if (sampleRate === undefined) throw new Error("data chunk before fmt chunk");
      return { sampleRate, pcm: wav.subarray(body, Math.min(wav.length, body + size)) };
    }
    at = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

/** Milliseconds of s16le mono audio. */
export function pcmDurationMs(pcm: Buffer, sampleRate: number): number {
  return Math.round((pcm.length / 2 / sampleRate) * 1000);
}
