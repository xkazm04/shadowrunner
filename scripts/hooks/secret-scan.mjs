// Fails when a key-shaped string lands in a file (client code above all). Never prints the secret.
import { readFileSync } from "node:fs";
import { readEvent, filesFrom } from "./_event.mjs";
const PATTERNS = [/sk-ant-[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /sk-(proj-)?[A-Za-z0-9]{32,}/, /ksk_[A-Za-z0-9]{20,}/];
let hit = 0;
for (const f of filesFrom(readEvent())) {
  if (/\.env(\.|$)/.test(f) && !f.endsWith(".env.example")) continue;
  const t = readFileSync(f, "utf8");
  PATTERNS.forEach((p) => { if (p.test(t)) { hit++; console.error(`secret-scan: key-shaped string in ${f} (pattern ${p.source.slice(0, 8)}...). Move it to an env var read in api/.`); } });
}
process.exit(hit ? 1 : 0);
