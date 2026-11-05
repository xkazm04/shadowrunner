// Joins O1's segments into one run.flv on the recording's own clock. Each segment starts at time 0
// in its own file (ffmpeg rebases every publisher), so the ffconcat list gives segment i the
// duration (start of i+1) - (start of i) from the Cluster timecodes: the outage stays a gap in the
// timestamps, which measure counts as dropped frames, instead of being spliced shut.
import { spawnSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Segment } from "./pipeline.js";

/** The ffconcat list for `segments` (in order), file names relative to the list. */
export function concatList(segments: readonly Segment[]): string {
  const lines = ["ffconcat version 1.0"];
  segments.forEach((s, i) => {
    lines.push(`file '${basename(s.file)}'`);
    const next = segments[i + 1];
    if (next !== undefined) lines.push(`duration ${Math.max(0.001, (next.startMs - s.startMs) / 1000).toFixed(3)}`);
  });
  return `${lines.join("\n")}\n`;
}

/** Writes `out` from the segments; one segment is simply renamed. Throws a sentence on failure. */
export function joinSegments(segments: readonly Segment[], out: string, ffmpeg: string): void {
  const first = segments[0];
  if (first === undefined) throw new Error("O1: the RTMP sink recorded nothing (no segment has data).");
  if (segments.length === 1) {
    renameSync(first.file, out);
    return;
  }
  const list = join(dirname(out), "run.segments.ffconcat");
  writeFileSync(list, concatList(segments));
  const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "flv", out], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`O1: joining ${segments.length} segments failed: ${r.stderr.trim().split(/\r?\n/).slice(-3).join(" | ")}`);
  for (const s of segments) rmSync(s.file, { force: true });
}
