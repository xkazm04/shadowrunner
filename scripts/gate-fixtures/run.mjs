// `pnpm test:gates`: proves every lint gate red on a seeded violation (requirements 1.3, 1.5).
// Each case runs the real tool (eslint / stylelint CLI, scripts/line-cap.mjs) on one fixture and
// checks the exit code and the exact set of rules reported. Controls must pass, so a broken
// config (which also exits non-zero) cannot pass as a "failure".
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const require = createRequire(import.meta.url);
const binOf = (pkg, bin) => join(dirname(require.resolve(`${pkg}/package.json`)), bin);
const ESLINT = binOf("eslint", "bin/eslint.js");
const STYLELINT = binOf("stylelint", "bin/stylelint.mjs");

// Lint-failure exit codes of each CLI (eslint 1; stylelint 2). Anything else is a crash.
const FAIL_EXIT = { eslint: 1, stylelint: 2 };

const CASES = [
  { tool: "eslint", fixture: "eslint/no-any.ts", rules: ["@typescript-eslint/no-explicit-any"] },
  { tool: "eslint", fixture: "eslint/as-unknown-as.ts", rules: ["no-restricted-syntax"] },
  { tool: "eslint", fixture: "eslint/unknown-assertion.ts", rules: ["no-restricted-syntax"] },
  { tool: "eslint", fixture: "eslint/clean.ts", rules: [] },
  { tool: "eslint", fixture: "boundary/packages/rig/src/breach.ts", root: "boundary", rules: ["boundaries/dependencies"] },
  { tool: "eslint", fixture: "boundary/packages/avatar/src/index.ts", root: "boundary", rules: [] },
  { tool: "eslint", fixture: "src-reach/reach.ts", rules: ["no-restricted-imports"], count: 4 },
  { tool: "eslint", fixture: "src-reach/clean.ts", rules: [] },
  { tool: "stylelint", fixture: "stylelint/hex.module.css", rules: ["color-no-hex", "scale-unlimited/declaration-strict-value"] },
  { tool: "stylelint", fixture: "stylelint/rgb.module.css", rules: ["function-disallowed-list"] },
  { tool: "stylelint", fixture: "stylelint/named.module.css", rules: ["color-named"] },
  { tool: "stylelint", fixture: "stylelint/px.module.css", rules: ["unit-disallowed-list"] },
  { tool: "stylelint", fixture: "stylelint/raw-value.module.css", rules: ["scale-unlimited/declaration-strict-value"] },
  { tool: "stylelint", fixture: "stylelint/clean.module.css", rules: [] },
  { tool: "line-cap", fixture: "line-cap/over", exit: 1, says: "too-long.ts has 401 lines" },
  { tool: "line-cap", fixture: "line-cap/at-cap", exit: 0 },
  { tool: "line-cap", fixture: "line-cap/no-sources", exit: 2, says: "scanned 0 files" },
];

function run(args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** First JSON array in the output (stylelint may print its report on stderr). */
function jsonReport(r) {
  for (const text of [r.stdout, r.stderr]) {
    const start = text.indexOf("[");
    if (start < 0) continue;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // not this stream
    }
  }
  return undefined;
}

function reportedRules(tool, report) {
  if (tool === "eslint") return report.flatMap((f) => f.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`));
  return report.flatMap((f) => [
    ...f.warnings.map((w) => w.rule),
    ...(f.invalidOptionWarnings ?? []).map((w) => `invalid option: ${w.text}`),
    ...(f.parseErrors ?? []).map((e) => `parse error: ${e.text}`),
  ]);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const uniqueSorted = (xs) => [...new Set(xs)].sort();

function check(c) {
  const target = join(HERE, c.fixture);
  if (c.tool === "line-cap") {
    const r = run([join(ROOT, "scripts", "line-cap.mjs"), target]);
    if (r.status !== c.exit) return `expected exit ${c.exit}, got ${r.status}\n${r.out}`;
    if (c.says && !r.out.includes(c.says)) return `expected output to mention "${c.says}"\n${r.out}`;
    return undefined;
  }
  const r =
    c.tool === "eslint"
      ? run([ESLINT, "--no-ignore", "--format", "json", target], c.root ? { ESLINT_PLUGIN_BOUNDARIES_ROOT_PATH: join(HERE, c.root) } : {})
      : run([STYLELINT, "--formatter", "json", target]);
  const wantExit = c.rules.length === 0 ? 0 : FAIL_EXIT[c.tool];
  const report = jsonReport(r);
  if (!report) return `no JSON report (exit ${r.status})\n${r.out}`;
  const got = uniqueSorted(reportedRules(c.tool, report));
  const want = uniqueSorted(c.rules);
  if (r.status !== wantExit || !same(got, want)) {
    return `expected exit ${wantExit} with [${want.join(", ")}], got exit ${r.status} with [${got.join(", ")}]`;
  }
  // `count`: the fixture seeds several forms of one violation, and every one must be reported.
  const reported = reportedRules(c.tool, report).length;
  if (c.count !== undefined && reported !== c.count) return `expected ${c.count} reports, got ${reported}`;
  return undefined;
}

let failures = 0;
for (const c of CASES) {
  const problem = check(c);
  const label = `${c.tool.padEnd(9)} ${relative(ROOT, join(HERE, c.fixture)).replaceAll("\\", "/")}`;
  if (problem) {
    failures += 1;
    console.error(`FAIL ${label}\n     ${problem.replaceAll("\n", "\n     ")}`);
  } else {
    const verdict = c.tool === "line-cap" ? `exit ${c.exit}` : c.rules.length ? `red: ${c.rules.join(", ")}` : "clean";
    console.log(`ok   ${label} (${verdict})`);
  }
}
console.log(`\ntest:gates: ${CASES.length - failures}/${CASES.length} fixtures behaved as expected.`);
process.exit(failures > 0 ? 1 : 0);
