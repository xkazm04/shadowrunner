// Synthetic speech for the lip-sync tests (perfection-pass task 4): vowels from a 120 Hz pulse train
// through three formant resonators (VOWELS), a sibilant from differentiated white noise, and
// silence. Deterministic (a seeded LCG).

export const SYNTH_RATE = 16000;

/** A vowel with formants f1-f3 (Hz), `seconds` long, peak `amp`. */
export function vowel(f1: number, f2: number, f3: number, seconds: number, amp = 0.3): Float32Array {
  const n = Math.round(seconds * SYNTH_RATE);
  const out = new Float32Array(n);
  const period = Math.round(SYNTH_RATE / 120);
  const res = [f1, f2, f3].map((f, i) => {
    const bw = [80, 100, 150][i] ?? 100;
    const r = Math.exp((-Math.PI * bw) / SYNTH_RATE);
    return { a1: 2 * r * Math.cos((2 * Math.PI * f) / SYNTH_RATE), a2: -r * r, y1: 0, y2: 0 };
  });
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    let x = i % period === 0 ? 1 : 0;
    for (const q of res) {
      const y = x + q.a1 * q.y1 + q.a2 * q.y2;
      q.y2 = q.y1;
      q.y1 = y;
      x = y;
    }
    out[i] = x;
    peak = Math.max(peak, Math.abs(x));
  }
  return out.map((v) => (v / peak) * amp);
}

/** An "s": differentiated white noise (energy above 4 kHz). */
export function hiss(seconds: number, amp = 0.08, seed = 7): Float32Array {
  const n = Math.round(seconds * SYNTH_RATE);
  const out = new Float32Array(n);
  let s = seed;
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const w = s / 2147483648 - 0.5;
    out[i] = (w - prev) * amp;
    prev = w;
  }
  return out;
}

export const silence = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * SYNTH_RATE));

/** Textbook formants (Hz): open /ae/, close /i/ and /u/, mid /e/ and /o/. */
export const VOWELS = {
  a: [850, 1600, 2600],
  i: [280, 2250, 2900],
  u: [320, 800, 2300],
  e: [500, 1800, 2500],
  o: [500, 900, 2400],
} as const;

/** The parts end to end, with each part's [start, end) in seconds. */
export function clipOf(parts: readonly (readonly [string, Float32Array])[]): { samples: Float32Array; spans: { name: string; start: number; end: number }[] } {
  const samples = new Float32Array(parts.reduce((s, [, x]) => s + x.length, 0));
  const spans: { name: string; start: number; end: number }[] = [];
  let at = 0;
  for (const [name, x] of parts) {
    samples.set(x, at);
    spans.push({ name, start: at / SYNTH_RATE, end: (at + x.length) / SYNTH_RATE });
    at += x.length;
  }
  return { samples, spans };
}
