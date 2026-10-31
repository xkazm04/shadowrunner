// Shared: read the hook event JSON from stdin (Kiro passes session context) and find file paths in it.
import { readFileSync, existsSync } from "node:fs";
export function readEvent() {
  try { const s = readFileSync(0, "utf8"); return s.trim() ? JSON.parse(s) : {}; } catch { return {}; }
}
export function filesFrom(ev) {
  const out = new Set();
  const walk = (v, k = "") => {
    if (typeof v === "string") { if (/(^|_)(path|file|filePath|file_path)$/i.test(k) && existsSync(v)) out.add(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, k)); return; }
    if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(ev);
  for (const a of process.argv.slice(2)) if (existsSync(a)) out.add(a);
  return [...out];
}
