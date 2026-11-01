#!/usr/bin/env bash
# Orchestration entry point: Claude Code (the director) hands ONE spec task to Kiro CLI.
#   scripts/kiro-task.sh <spec> <task-id> [--model claude-opus-5.5] [--effort xhigh] [--review] [--note "extra brief"]
# Kiro implements it as the sr-builder agent (deny rules protect the spec contract, steering, git);
# --review adds a read-only sr-reviewer pass. Every run is logged under var/kiro-runs/ as JSONL
# (stream-json) so the director can audit it and docs/kiro-log.md can cite it.
set -euo pipefail
spec="$1"; task="$2"; shift 2
model="claude-opus-5.5"; effort="xhigh"; review=0; note=""
while [ $# -gt 0 ]; do case "$1" in
  --model) model="$2"; shift 2;; --effort) effort="$2"; shift 2;; --review) review=1; shift;; --note) note="$2"; shift 2;;
  *) echo "unknown arg $1" >&2; exit 2;; esac; done
case "$model" in claude-sonnet-4.5) echo "sonnet-4.5 is banned as builder (owner rule)" >&2; exit 2;; esac
[ -f ".kiro/specs/$spec/tasks.md" ] || { echo "no spec .kiro/specs/$spec" >&2; exit 2; }
run="var/kiro-runs/$(date -u +%Y%m%dT%H%M%SZ)-$spec-$task"; mkdir -p "$run"
git diff --stat > "$run/before.diffstat" 2>/dev/null || true
prompt="Implement task $task of spec '$spec' (.kiro/specs/$spec/). Follow your agent instructions exactly and end with the final report block. ${note}"
echo "[kiro-task] $spec#$task model=$model effort=$effort -> $run"
kiro-cli chat --v3 --agent sr-builder --no-interactive --trust-workspace --trust-all-tools \
  --model "$model" --effort "$effort" --output-format stream-json "$prompt" > "$run/build.jsonl" 2> "$run/build.err" || echo "[kiro-task] builder exit=$?" | tee -a "$run/build.err"
git status --short > "$run/after.status" 2>/dev/null || true
if [ "$review" = 1 ]; then
  kiro-cli chat --v3 --agent sr-reviewer --no-interactive --trust-workspace --trust-all-tools \
    --model claude-sonnet-5.5 --effort high "Review task $task of spec '$spec' against the working-tree diff." > "$run/review.txt" 2>&1 || true
  grep -E "^VERDICT:" "$run/review.txt" || echo "[kiro-task] reviewer gave no verdict"
fi
tail -n 1 var/kiro-runs/gates.jsonl 2>/dev/null > "$run/gates.json" || true
echo "[kiro-task] done: $run"
