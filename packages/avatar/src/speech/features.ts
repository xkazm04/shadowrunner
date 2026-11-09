// Speech features (perfection-pass task 4, lip-sync): a decoded voice clip cut into 10 ms frames and
// described the way speech recognisers describe sound, for the shape classifier (speech/model.ts).
// Pure, no DOM, deterministic.
//
// Decisions:
// - The clip is first brought to ANALYSIS_RATE (16 kHz; a windowed-sinc low-pass, then linear
//   interpolation), so every source rate yields the same features; a browser decoding at 16 kHz
//   (air/mouthTrack.ts) skips that step.
// - Per frame (25 ms Hamming window every FRAME_S, 0.97 pre-emphasis): the log energy against the
//   clip's loudest frame (dB / 10, floored at -70 dB), the zero-crossing rate (x 10) and 12 MFCCs
//   (24 mel bands to 8 kHz, DCT-II) with the clip's mean over its voiced frames removed (cepstral
//   mean normalisation: the voice's own timbre and the recording's colour cancel, the movement
//   between sounds stays). FEATURES = 14 numbers per frame.
// - Frame i is centred at i * FRAME_S.

export const ANALYSIS_RATE = 16000;
/** Hop between frames, seconds. */
export const FRAME_S = 0.01;
const WINDOW = 400; // 25 ms at 16 kHz
const FFT_SIZE = 512;
const MEL_BANDS = 24;
const CEPSTRA = 12;
/** Frames this loud (dB under the clip's peak) or louder set the cepstral mean. */
const VOICED_DB = -35;
const FLOOR_DB = -70;
export const FEATURES = 2 + CEPSTRA;

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();

/** cos/sin of -2 pi k / n for k < n / 2, built once per size. */
function twiddlesOf(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = twiddles.get(n);
  if (t === undefined) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k += 1) {
      cos[k] = Math.cos((-2 * Math.PI * k) / n);
      sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    t = { cos, sin };
    twiddles.set(n, t);
  }
  return t;
}

/** In-place iterative radix-2 FFT of (re, im), length a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const table = twiddlesOf(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = table.cos[k * stride] ?? 1;
        const wi = table.sin[k * stride] ?? 0;
        const a = start + k;
        const b = a + half;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/** `samples` at ANALYSIS_RATE (a low-pass under the new Nyquist first when it goes down). */
export function resample(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === ANALYSIS_RATE) return samples;
  const ratio = sampleRate / ANALYSIS_RATE;
  let source = samples;
  if (ratio > 1) {
    // Windowed-sinc low-pass at 0.45 of the target rate, 8 lobes wide.
    const cut = (0.45 * ANALYSIS_RATE) / sampleRate;
    const half = Math.ceil(4 / cut);
    const taps = new Float64Array(2 * half + 1);
    let sum = 0;
    for (let i = -half; i <= half; i += 1) {
      const x = 2 * cut * i;
      const sinc = i === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * i) / half) + 0.08 * Math.cos((2 * Math.PI * i) / half);
      taps[i + half] = sinc * w;
      sum += sinc * w;
    }
    source = new Float32Array(samples.length);
    const n = samples.length;
    for (let k = 0; k < n; k += 1) {
      let acc = 0;
      const lo = Math.max(-half, -k);
      const hi = Math.min(half, n - 1 - k);
      for (let t = lo; t <= hi; t += 1) acc += (samples[k + t] ?? 0) * (taps[t + half] ?? 0);
      source[k] = acc / sum;
    }
  }
  const count = Math.max(0, Math.floor((samples.length - 1) / ratio) + 1);
  const out = new Float32Array(count);
  for (let j = 0; j < count; j += 1) {
    const x = j * ratio;
    const k = Math.floor(x);
    const f = x - k;
    out[j] = (source[k] ?? 0) * (1 - f) + (source[k + 1] ?? source[k] ?? 0) * f;
  }
  return out;
}

interface Filter {
  from: number;
  weights: Float64Array;
}

let filterBank: Filter[] | undefined;

/** Triangular mel filters over the FFT bins, 0 Hz to 8 kHz. */
function melFilters(): Filter[] {
  if (filterBank !== undefined) return filterBank;
  const mel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
  const hzOf = (m: number): number => 700 * (10 ** (m / 2595) - 1);
  const top = mel(ANALYSIS_RATE / 2);
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => hzOf((top * i) / (MEL_BANDS + 1)));
  const binHz = ANALYSIS_RATE / FFT_SIZE;
  filterBank = Array.from({ length: MEL_BANDS }, (_, m) => {
    const [a, b, c] = [edges[m] ?? 0, edges[m + 1] ?? 0, edges[m + 2] ?? 0];
    const from = Math.max(1, Math.ceil(a / binHz));
    const to = Math.min(FFT_SIZE / 2, Math.floor(c / binHz));
    const weights = new Float64Array(Math.max(0, to - from + 1));
    for (let k = from; k <= to; k += 1) {
      const hz = k * binHz;
      weights[k - from] = Math.max(0, hz < b ? (hz - a) / (b - a) : (c - hz) / (c - b));
    }
    return { from, weights };
  });
  return filterBank;
}

export interface SpeechFeatures {
  /** FEATURES numbers per frame, frame-major. */
  values: Float32Array;
  frames: number;
  /** Each frame's level in dB against the clip's loudest frame (FLOOR_DB at most quiet). */
  db: Float32Array;
}

/** The clip's frames, one every FRAME_S from t = 0. */
export function speechFeatures(input: Float32Array, sampleRate: number): SpeechFeatures {
  const samples = sampleRate > 0 ? resample(input, sampleRate) : new Float32Array(0);
  const hop = Math.round(FRAME_S * ANALYSIS_RATE);
  const frames = samples.length === 0 ? 0 : Math.ceil(samples.length / hop);
  const filters = melFilters();
  const hamming = Float64Array.from({ length: WINDOW }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
  // DCT-II rows for cepstra 1..CEPSTRA (c0, the overall level, is left out: energy stands in).
  const dct = Float64Array.from({ length: CEPSTRA * MEL_BANDS }, (_, i) => Math.cos((Math.PI * (Math.floor(i / MEL_BANDS) + 1) * ((i % MEL_BANDS) + 0.5)) / MEL_BANDS));
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2 + 1);
  const logMel = new Float64Array(MEL_BANDS);
  const cepstra = new Float64Array(frames * CEPSTRA);
  const energy = new Float64Array(frames);
  const zcr = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop - WINDOW / 2;
    re.fill(0);
    im.fill(0);
    let sq = 0;
    let crossings = 0;
    let prev = samples[start] ?? 0;
    for (let i = 0; i < WINDOW; i += 1) {
      const x = samples[start + i] ?? 0;
      sq += x * x;
      if (x >= 0 !== prev >= 0) crossings += 1;
      re[i] = (x - 0.97 * prev) * (hamming[i] ?? 0);
      prev = x;
    }
    fft(re, im);
    for (let k = 0; k <= FFT_SIZE / 2; k += 1) power[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    for (let m = 0; m < MEL_BANDS; m += 1) {
      const filter = filters[m];
      let acc = 1e-10;
      if (filter !== undefined) for (let k = 0; k < filter.weights.length; k += 1) acc += (power[filter.from + k] ?? 0) * (filter.weights[k] ?? 0);
      logMel[m] = Math.log(acc);
    }
    for (let c = 0; c < CEPSTRA; c += 1) {
      let acc = 0;
      for (let m = 0; m < MEL_BANDS; m += 1) acc += (logMel[m] ?? 0) * (dct[c * MEL_BANDS + m] ?? 0);
      cepstra[f * CEPSTRA + c] = acc / MEL_BANDS;
    }
    energy[f] = Math.sqrt(sq / WINDOW);
    zcr[f] = crossings / WINDOW;
  }
  let peak = 1e-6;
  for (let f = 0; f < frames; f += 1) peak = Math.max(peak, energy[f] ?? 0);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) db[f] = Math.max(FLOOR_DB, 20 * Math.log10((energy[f] ?? 0) / peak + 1e-9));
  const mean = new Float64Array(CEPSTRA);
  let voiced = 0;
  for (let f = 0; f < frames; f += 1) {
    if (!((db[f] ?? FLOOR_DB) > VOICED_DB)) continue;
    voiced += 1;
    for (let c = 0; c < CEPSTRA; c += 1) mean[c] = (mean[c] ?? 0) + (cepstra[f * CEPSTRA + c] ?? 0);
  }
  for (let c = 0; c < CEPSTRA; c += 1) mean[c] = (mean[c] ?? 0) / Math.max(1, voiced);
  const values = new Float32Array(frames * FEATURES);
  for (let f = 0; f < frames; f += 1) {
    const at = f * FEATURES;
    values[at] = (db[f] ?? FLOOR_DB) / 10;
    values[at + 1] = (zcr[f] ?? 0) * 10;
    for (let c = 0; c < CEPSTRA; c += 1) values[at + 2 + c] = (cepstra[f * CEPSTRA + c] ?? 0) - (mean[c] ?? 0);
  }
  return { values, frames, db };
}
