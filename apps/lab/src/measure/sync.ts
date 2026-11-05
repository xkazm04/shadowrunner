// A/V offset from a recording alone. Mouth-region motion energy (mean absolute frame difference in
// the ROI, frame k vs k-1) is a *change* signal; its audio partner is the change of the RMS envelope
// over the same frame interval, |E(t_k) - E(t_{k-1})|, with E(t) the RMS of the audio in a
// frame-long window centred on t (a frame shows the instant it was drawn; a window ending at t would
// bias the lag by half a frame). Correlating motion with the envelope itself would bias the lag by about a
// quarter syllable (the mouth moves fastest while the level rises, not while it is high); change
// against change has no such bias for a mouth that follows the level (L0) or the visemes.
// The lag L maximising Pearson r is avOffsetMs: + means the mouth lags the audio.

export interface AudioTrack {
  /** Mono samples; sample i is at time i / sampleRate seconds on the recording's clock. */
  samples: Float32Array;
  sampleRate: number;
}

export interface MotionTrack {
  /** Frame times, seconds, ascending. */
  times: number[];
  /** Motion energy of frame k (vs k-1); index 0 is unused (0). */
  energy: number[];
}

export interface SyncResult {
  avOffsetMs: number;
  /** Pearson r at the best lag. */
  peakR: number;
  /** Best r at least `RUNNER_UP_GAP_MS` away from the best lag. */
  runnerUpR: number;
  /** (peakR - mean r) / std r over every lag searched. */
  z: number;
  /**
   * high: peakR >= 0.5 and peakR - runnerUpR >= 0.1; medium: peakR >= 0.25 and a margin >= 0.05;
   * else low. (z stays informative only: speech is quasi-periodic, so r is high over a broad band of
   * lags and z is small even for a clean, sharp peak.)
   */
  confidence: "high" | "medium" | "low";
  frames: number;
  searchMs: number;
  stepMs: number;
}

export const RUNNER_UP_GAP_MS = 100;

/** Prefix sums of squares, so the RMS of any window is O(1). */
function squareSums(samples: Float32Array): Float64Array {
  const out = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    out[i + 1] = (out[i] ?? 0) + s * s;
  }
  return out;
}

function pearson(x: readonly number[] | Float64Array, y: Float64Array, n: number): number {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i] ?? 0;
    sy += y[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (x[i] ?? 0) - mx;
    const b = (y[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/** Lag search over +-searchMs in stepMs steps. Throws a sentence when there is too little to correlate. */
export function findOffset(motion: MotionTrack, audio: AudioTrack, searchMs = 500, stepMs = 1): SyncResult {
  const { times, energy } = motion;
  if (times.length < 30) throw new Error(`Only ${times.length} video frames: too few to measure A/V offset.`);
  const intervals = times.slice(1).map((t, i) => t - (times[i] ?? t)).sort((a, b) => a - b);
  const frameS = intervals[Math.floor(intervals.length / 2)] ?? 1 / 30;
  const sums = squareSums(audio.samples);
  const win = Math.max(1, Math.round(frameS * audio.sampleRate));
  const last = audio.samples.length;
  /** RMS of the frame-long window centred on `t` seconds (0 outside the audio): a frame shows the instant it was drawn. */
  const env = (t: number): number => {
    const end = Math.min(last, Math.max(0, Math.round(t * audio.sampleRate) + (win >> 1)));
    const start = Math.max(0, Math.min(end, Math.round(t * audio.sampleRate) - (win >> 1)));
    return end > start ? Math.sqrt(((sums[end] ?? 0) - (sums[start] ?? 0)) / (end - start)) : 0;
  };
  const n = times.length - 1;
  const m = energy.slice(1);
  const a = new Float64Array(n);
  const rs: { lag: number; r: number }[] = [];
  for (let lag = -searchMs; lag <= searchMs; lag += stepMs) {
    const l = lag / 1000;
    for (let k = 1; k <= n; k += 1) a[k - 1] = Math.abs(env((times[k] ?? 0) - l) - env((times[k - 1] ?? 0) - l));
    rs.push({ lag, r: pearson(m, a, n) });
  }
  const best = rs.reduce((p, c) => (c.r > p.r ? c : p));
  const runnerUp = rs.filter((x) => Math.abs(x.lag - best.lag) >= RUNNER_UP_GAP_MS).reduce((p, c) => Math.max(p, c.r), -1);
  const mean = rs.reduce((s, x) => s + x.r, 0) / rs.length;
  const std = Math.sqrt(rs.reduce((s, x) => s + (x.r - mean) ** 2, 0) / rs.length);
  const z = std > 0 ? (best.r - mean) / std : 0;
  const margin = best.r - runnerUp;
  const confidence = best.r >= 0.5 && margin >= 0.1 ? "high" : best.r >= 0.25 && margin >= 0.05 ? "medium" : "low";
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return { avOffsetMs: best.lag, peakR: r3(best.r), runnerUpR: r3(runnerUp), z: Math.round(z * 10) / 10, confidence, frames: times.length, searchMs, stepMs };
}

/** Mean absolute difference between consecutive gray frames (each `size` bytes in `frames`). */
export function motionEnergy(frames: Uint8Array, size: number): number[] {
  const count = Math.floor(frames.length / size);
  const out: number[] = [0];
  for (let k = 1; k < count; k += 1) {
    let sum = 0;
    const a = (k - 1) * size;
    const b = k * size;
    for (let i = 0; i < size; i += 1) sum += Math.abs((frames[b + i] ?? 0) - (frames[a + i] ?? 0));
    out.push(sum / size);
  }
  return out;
}
