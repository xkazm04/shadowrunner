// Just enough Matroska/WebM framing for a live MediaRecorder byte stream: the init segment (EBML
// header + Segment + Info + Tracks, everything before the first Cluster) and the next Cluster start.
// A restarted ffmpeg publisher is fed the init segment, then the stream from a Cluster boundary on,
// which is a valid Matroska stream again (MediaRecorder starts clusters at keyframes).

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75] as const;
const TIMECODE_ID = 0xe7;

/** Length of an EBML variable-size integer from its first byte (1..8), or 0 when invalid. */
export function vintLength(first: number): number {
  for (let n = 1; n <= 8; n += 1) if (first & (0x80 >> (n - 1))) return n;
  return 0;
}

/**
 * Offset of the first Cluster element at or after `from`, checked by its structure (a valid size
 * vint followed by the Cluster's Timecode element), or -1. A random 4-byte match inside frame data
 * is rejected by that check.
 */
export function findCluster(bytes: Uint8Array, from = 0): number {
  for (let i = Math.max(0, from); i + 6 <= bytes.length; i += 1) {
    if (bytes[i] !== CLUSTER_ID[0] || bytes[i + 1] !== CLUSTER_ID[1] || bytes[i + 2] !== CLUSTER_ID[2] || bytes[i + 3] !== CLUSTER_ID[3]) continue;
    const size = vintLength(bytes[i + 4] ?? 0);
    if (size === 0) continue;
    const child = i + 4 + size;
    if (child >= bytes.length) return i; // the structure check needs bytes not yet received; accept
    if (bytes[child] === TIMECODE_ID) return i;
  }
  return -1;
}

/** The Cluster timecode (ms with MediaRecorder's default 1 ms scale) of the Cluster at `at`. */
export function clusterTimecode(bytes: Uint8Array, at: number): number | undefined {
  const sizeLen = vintLength(bytes[at + 4] ?? 0);
  let p = at + 4 + sizeLen;
  if (bytes[p] !== 0xe7) return undefined;
  p += 1;
  const len = vintLength(bytes[p] ?? 0);
  if (len === 0) return undefined;
  let n = (bytes[p] ?? 0) & (0xff >> len);
  for (let i = 1; i < len; i += 1) n = n * 256 + (bytes[p + i] ?? 0);
  p += len;
  let value = 0;
  for (let i = 0; i < n; i += 1) value = value * 256 + (bytes[p + i] ?? 0);
  return p + n <= bytes.length ? value : undefined;
}

/** Accumulates the live stream's first bytes until the init segment (before the first Cluster) is known. */
export class InitSegment {
  #parts: Uint8Array[] = [];
  #header: Uint8Array | undefined;
  /** Timecode of the stream's first Cluster (the recorder's start, normally 0). */
  firstClusterMs: number | undefined;

  /** The init segment, once the first Cluster has been seen. */
  get header(): Uint8Array | undefined {
    return this.#header;
  }

  /** Feeds a chunk; returns the init segment once complete. */
  push(chunk: Uint8Array): Uint8Array | undefined {
    if (this.#header !== undefined) return this.#header;
    this.#parts.push(chunk);
    const all = Buffer.concat(this.#parts);
    const at = findCluster(all);
    if (at >= 0) {
      this.#header = all.subarray(0, at);
      this.firstClusterMs = clusterTimecode(all, at);
      this.#parts = [];
    }
    return this.#header;
  }
}
