// Pull the builder's final report block out of a kiro-cli stream-json transcript.
//   node scripts/kiro-report.mjs <build.jsonl> [out.txt]
import fs from "node:fs";
const [src, out] = process.argv.slice(2);
let fin = null;
for (const line of fs.readFileSync(src, "utf8").split("\n")) {
  try { const e = JSON.parse(line); if (e.type === "runFinished") fin = e.data; } catch { /* partial line */ }
}
const text = fin?.finalText ?? "";
const at = text.lastIndexOf("TASK:");
const body = (fin ? `run: ${fin.status} / ${fin.stopReason}\n` : "run: no runFinished event\n")
  + (at >= 0 ? text.slice(at) : "(no final report block)") + "\n";
if (out) fs.writeFileSync(out, body); else process.stdout.write(body);
