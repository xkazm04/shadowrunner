// Stop hook: run the gates and append the outcome to var/kiro-runs/gates.jsonl for the orchestrator.
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("var/kiro-runs", { recursive: true });
const row = { ts: new Date().toISOString(), gates: {} };
if (!existsSync("pnpm-workspace.yaml")) row.note = "no workspace yet - gates skipped";
else for (const g of ["typecheck", "lint", "test"]) {
  const r = spawnSync("pnpm", ["-s", g], { encoding: "utf8", shell: process.platform === "win32" });
  row.gates[g] = r.status === 0 ? "pass" : "fail";
  if (r.status !== 0) row[`${g}_tail`] = (r.stdout + r.stderr).split("\n").slice(-15).join("\n");
}
appendFileSync("var/kiro-runs/gates.jsonl", JSON.stringify(row) + "\n");
const failed = Object.entries(row.gates).filter(([, v]) => v === "fail").map(([k]) => k);
if (failed.length) { console.error(`gates failed: ${failed.join(", ")} - fix before reporting done`); process.exit(1); }
