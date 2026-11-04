// A recorded take's length, written into the WebM (found by the live e2e run, 2026-11-04): Chrome's
// MediaRecorder streams a WebM whose Segment Info has no Duration, so video editors show the clip
// with no length and cannot seek it. After the take we know how long it ran, so we add the EBML
// Duration element to Segment > Info (or overwrite a present one).
//
// Decisions:
// - Pure bytes in, bytes out; anything unexpected (not EBML, no Segment, no Info, an unknown-size
//   element before Info) returns the input unchanged: a take is never lost to the patch.
// - Duration is in TimecodeScale units (default 1 000 000 ns = 1 ms), stored as a float64.
// - Info's size is re-encoded in the shortest EBML varint that holds it; the Segment's size is
//   "unknown" in a MediaRecorder file, and a known Segment size is grown by the same delta.

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const DURATION_ID = 0x4489;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DEFAULT_SCALE_NS = 1_000_000;

interface Vint {
  value: number;
  length: number;
  /** All value bits set: the "unknown size" marker. */
  unknown: boolean;
}

/** An EBML varint at `pos` (sizes: the marker bit masked off), or undefined past the end. */
function readVint(bytes: Uint8Array, pos: number, keepMarker = false): Vint | undefined {
  const first = bytes[pos];
  if (first === undefined || first === 0) return undefined;
  const length = Math.clz32(first) - 23;
  if (length > 8 || pos + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[pos + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** The shortest EBML size varint for `value` (never the all-ones "unknown" pattern). */
function encodeSize(value: number): Uint8Array {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) length += 1;
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (length - 1));
  return out;
}

interface Element {
  id: number;
  start: number;
  /** Where the payload starts. */
  data: number;
  size: Vint;
}

function readElement(bytes: Uint8Array, pos: number): Element | undefined {
  const id = readVint(bytes, pos, true);
  if (id === undefined) return undefined;
  const size = readVint(bytes, pos + id.length);
  if (size === undefined) return undefined;
  return { id: id.value, start: pos, data: pos + id.length + size.length, size };
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The WebM with its Segment Info carrying `durationMs`, or the input unchanged when it cannot be. */
export function withWebmDuration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return bytes;
  const header = readElement(bytes, 0);
  if (header?.id !== EBML_ID || header.size.unknown) return bytes;
  const segment = readElement(bytes, header.data + header.size.value);
  if (segment?.id !== SEGMENT_ID) return bytes;

  let pos = segment.data;
  let info: Element | undefined;
  while (pos < bytes.length) {
    const child = readElement(bytes, pos);
    if (child === undefined || child.size.unknown) return bytes;
    if (child.id === INFO_ID) {
      info = child;
      break;
    }
    pos = child.data + child.size.value;
  }
  if (info === undefined) return bytes;
  const infoEnd = info.data + info.size.value;
  if (infoEnd > bytes.length) return bytes;

  let scale = DEFAULT_SCALE_NS;
  let present: Element | undefined;
  for (let at = info.data; at < infoEnd; ) {
    const child = readElement(bytes, at);
    if (child === undefined || child.size.unknown) return bytes;
    if (child.id === TIMECODE_SCALE_ID) {
      scale = 0;
      for (let i = 0; i < child.size.value; i += 1) scale = scale * 256 + (bytes[child.data + i] ?? 0);
    }
    if (child.id === DURATION_ID) present = child;
    at = child.data + child.size.value;
  }
  if (!(scale > 0)) return bytes;
  const value = (durationMs * 1_000_000) / scale;

  if (present !== undefined) {
    const out = bytes.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    if (present.size.value === 8) view.setFloat64(present.data, value);
    else if (present.size.value === 4) view.setFloat32(present.data, value);
    else return bytes;
    return out;
  }

  const duration = concat([new Uint8Array([0x44, 0x89, 0x88]), float64(value)]);
  const infoIdLength = info.data - info.size.length - info.start;
  const newInfo = concat([
    bytes.subarray(info.start, info.start + infoIdLength),
    encodeSize(info.size.value + duration.length),
    bytes.subarray(info.data, infoEnd),
    duration,
  ]);
  const grown = newInfo.length - (infoEnd - info.start);
  const segmentHead = segment.size.unknown
    ? bytes.subarray(segment.start, segment.data)
    : concat([bytes.subarray(segment.start, segment.data - segment.size.length), encodeSize(segment.size.value + grown)]);
  return concat([bytes.subarray(0, segment.start), segmentHead, bytes.subarray(segment.data, info.start), newInfo, bytes.subarray(infoEnd)]);
}

/** `withWebmDuration` on a Blob; any failure gives the Blob back as it was. */
export async function blobWithDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const patched = withWebmDuration(bytes, durationMs);
    return patched === bytes ? blob : new Blob([new Uint8Array(patched)], { type: blob.type });
  } catch {
    return blob;
  }
}
