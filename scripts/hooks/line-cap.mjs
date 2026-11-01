// 400-line cap per source file (steering: tech.md). Exits 1 naming the offender.
import { readFileSync } from "node:fs";
import { readEvent, filesFrom } from "./_event.mjs";
const CAP = 400;
const bad = filesFrom(readEvent()).filter((f) => /\.(ts|tsx|css)$/.test(f))
  .map((f) => [f, readFileSync(f, "utf8").replace(/\n$/, "").split("\n").length]).filter(([, n]) => n > CAP);
for (const [f, n] of bad) console.error(`line-cap: ${f} has ${n} lines (cap ${CAP}). Split it by responsibility.`);
process.exit(bad.length ? 1 : 0);
