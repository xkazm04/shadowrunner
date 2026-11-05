// `measure synth <out.flv|out.webm> [--offset <ms>] [--seconds <n>]`: writes a synthetic clip whose
// mouth lags its audio by --offset ms (default 120), for validating measure (synth.ts).
import { synthClip } from "./synth.js";

export async function synthCommand(argv: readonly string[], log: (line: string) => void): Promise<void> {
  const out = argv.find((a, i) => !a.startsWith("--") && !(argv[i - 1] ?? "").startsWith("--"));
  if (out === undefined) throw new Error("synth needs an output file: synth <out.flv|out.webm> [--offset <ms>] [--seconds <n>].");
  const flag = (name: string, fallback: number): number => {
    const at = argv.indexOf(name);
    const n = at < 0 ? fallback : Number(argv[at + 1]);
    if (!Number.isFinite(n)) throw new Error(`${name} needs a number.`);
    return n;
  };
  const offsetMs = flag("--offset", 120);
  const seconds = flag("--seconds", 20);
  await synthClip({ out, offsetMs, seconds, format: out.endsWith(".webm") ? "webm" : "flv" });
  log(`synthetic clip: ${out} (mouth lags audio by ${offsetMs} ms; ROI ${"110,50,100,80"})`);
}
