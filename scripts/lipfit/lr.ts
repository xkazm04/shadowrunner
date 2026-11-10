// Multinomial logistic regression for the shape classifier: inputs standardised, minibatch Adam with
// L2, a seeded generator for the start weights and the shuffle, so a corpus fits to the same weights
// every run. The summation order is part of that: keep it if you touch the loops.

export interface Net { W: number[][]; b: number[]; mu: number[]; sd: number[] }
export interface FitOptions { epochs?: number; lr?: number; l2?: number; seed?: number }

const at = (a: readonly number[], i: number): number => a[i] ?? 0;

export function fit(X: readonly number[][], y: readonly number[], K: number, o: FitOptions = {}): Net {
  const N = X.length;
  const D = X[0]?.length ?? 0;
  const mu = Array.from({ length: D }, (_, d) => X.reduce((s, x) => s + at(x, d), 0) / N);
  const sd = Array.from({ length: D }, (_, d) => Math.sqrt(X.reduce((s, x) => s + (at(x, d) - at(mu, d)) ** 2, 0) / N) || 1);
  const Z = X.map((x) => x.map((v, d) => (v - at(mu, d)) / at(sd, d)));
  let seed = o.seed ?? 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const W = Array.from({ length: K }, () => Array.from({ length: D }, () => rnd() * 0.1));
  const b = new Array<number>(K).fill(0);
  const params = [...W, b];
  const m = params.map((p) => new Array<number>(p.length).fill(0));
  const v = params.map((p) => new Array<number>(p.length).fill(0));
  const grads = params.map((p) => new Array<number>(p.length).fill(0));
  const gb = grads[K] ?? [];
  const lr = o.lr ?? 0.01;
  const l2 = o.l2 ?? 1e-4;
  const B = 128;
  let step = 0;
  const idx = [...Array(N).keys()];
  for (let ep = 0; ep < (o.epochs ?? 30); ep++) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor((rnd() + 0.5) * (i + 1));
      [idx[i], idx[j]] = [at(idx, j), at(idx, i)];
    }
    for (let s = 0; s < N; s += B) {
      for (const g of grads) g.fill(0);
      const batch = idx.slice(s, s + B);
      for (const n of batch) {
        const x = Z[n] ?? [];
        const z = W.map((w, k) => w.reduce((a, wi, j) => a + wi * at(x, j), at(b, k)));
        const mx = Math.max(...z);
        const e = z.map((q) => Math.exp(q - mx));
        const se = e.reduce((a, q) => a + q);
        e.forEach((q, k) => {
          const dk = q / se - (k === y[n] ? 1 : 0);
          gb[k] = at(gb, k) + dk;
          const row = grads[k] ?? [];
          for (let j = 0; j < D; j++) row[j] = at(row, j) + dk * at(x, j);
        });
      }
      step++;
      params.forEach((p, pi) => {
        const g = grads[pi] ?? [];
        const mp = m[pi] ?? [];
        const vp = v[pi] ?? [];
        for (let q = 0; q < p.length; q++) {
          const gq = at(g, q) / batch.length + l2 * at(p, q);
          mp[q] = 0.9 * at(mp, q) + 0.1 * gq;
          vp[q] = 0.999 * at(vp, q) + 0.001 * gq * gq;
          p[q] = at(p, q) - (lr * (at(mp, q) / (1 - 0.9 ** step))) / (Math.sqrt(at(vp, q) / (1 - 0.999 ** step)) + 1e-8);
        }
      });
    }
  }
  return { W, b, mu, sd };
}

/** Log posteriors of the K classes for one raw (unstandardised) input. */
export function logp(net: Net, x0: readonly number[]): number[] {
  const x = x0.map((v, d) => (v - at(net.mu, d)) / at(net.sd, d));
  const z = net.W.map((w, k) => w.reduce((a, wi, j) => a + wi * at(x, j), at(net.b, k)));
  const mx = Math.max(...z);
  const ls = Math.log(z.reduce((a, q) => a + Math.exp(q - mx), 0)) + mx;
  return z.map((q) => q - ls);
}
