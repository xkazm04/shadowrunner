// mulberry32 seeded RNG (avatar-renderer design.md), as pure functions over a uint32 state so the
// driver state stays plain data: every draw returns the value and the next state.

/** A uint32 RNG state from any number (non-finite seeds become 0; fractions truncate). */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** The next value in [0, 1) and the next state. */
export function nextRandom(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(s ^ (s >>> 15), 1 | s);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, s >>> 0];
}

/** A value drawn uniformly from [min, max) and the next state. */
export function uniform(state: number, min: number, max: number): [value: number, state: number] {
  const [u, next] = nextRandom(state);
  return [min + (max - min) * u, next];
}
