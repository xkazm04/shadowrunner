import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Layer, Rig } from "@sr/rig";
import { measureFile } from "../measure.js";
import { frameStats } from "../probe.js";
import { jawRoi, parseRoi } from "../roi.js";
import { envelope, SYNTH_ROI, synthClip } from "../synth.js";
import { findOffset } from "../sync.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

/** In-memory mouth/audio pair: the mouth follows the envelope `offsetMs` after the audio. */
function pair(offsetMs: number, fps = 30, seconds = 20) {
  const env = envelope(seconds, 3);
  const rate = 8000;
  const samples = new Float32Array(seconds * rate);
  for (let i = 0; i < samples.length; i += 1) samples[i] = env(i / rate) * Math.sin((2 * Math.PI * 200 * i) / rate);
  const times: number[] = [];
  const open: number[] = [];
  for (let k = 0; k < seconds * fps; k += 1) {
    times.push(k / fps);
    open.push(env(k / fps - offsetMs / 1000));
  }
  const energy = open.map((o, k) => (k === 0 ? 0 : Math.abs(o - (open[k - 1] ?? 0))));
  return { motion: { times, energy }, audio: { samples, sampleRate: rate } };
}

describe("findOffset", () => {
  for (const offset of [120, -80, 0, 333]) {
    it(`recovers a ${offset} ms offset within one frame`, () => {
      const { motion, audio } = pair(offset);
      const r = findOffset(motion, audio);
      expect(Math.abs(r.avOffsetMs - offset)).toBeLessThanOrEqual(1000 / 30);
      expect(r.confidence).not.toBe("low");
    });
  }

  it("says low confidence when the mouth does not follow the audio", () => {
    const { audio } = pair(0);
    const times = Array.from({ length: 600 }, (_, k) => k / 30);
    const energy = times.map((_, k) => ((k * 7919) % 13) / 13);
    expect(findOffset({ times, energy }, audio).confidence).toBe("low");
  });

  it("refuses too few frames", () => {
    expect(() => findOffset({ times: [0, 1], energy: [0, 1] }, { samples: new Float32Array(10), sampleRate: 10 })).toThrow(/too few/);
  });
});

describe("frameStats", () => {
  it("per-frame fps percentiles and frames missing from the cadence", () => {
    const times = Array.from({ length: 31 }, (_, i) => i / 30).filter((_, i) => i !== 10 && i !== 11);
    const s = frameStats(times);
    expect(s?.fpsP50).toBe(30);
    expect(s?.droppedFrames).toBe(2);
    expect(frameStats([0])).toBeUndefined();
  });
});

describe("ROI", () => {
  it("parses x,y,w,h and refuses anything else", () => {
    expect(parseRoi("1,2,30,40")).toEqual({ x: 1, y: 2, w: 30, h: 40 });
    expect(() => parseRoi("1,2,30")).toThrow(/--roi/);
    expect(() => parseRoi("1,2,1,40")).toThrow(/--roi/);
  });

  it("maps the jaw bbox (plus drop and margins) through the contain fit", () => {
    const jaw: Layer = { name: "jaw", z: 1, kind: "jaw", file: "j.png", bbox: [400, 600, 200, 100], anchor: [500, 600] };
    const rig: Pick<Rig, "width" | "height" | "layers"> = { width: 1000, height: 1000, layers: [jaw] };
    const roi = jawRoi(rig, 1920, 1080);
    // scale 1.08, x offset 420: the ROI contains the jaw's own box on the stage.
    expect(roi.x).toBeLessThanOrEqual(420 + 400 * 1.08);
    expect(roi.y).toBeLessThanOrEqual(600 * 1.08);
    expect(roi.x + roi.w).toBeGreaterThanOrEqual(420 + 600 * 1.08 - 2);
    expect(roi.y + roi.h).toBeGreaterThanOrEqual(700 * 1.08);
    expect(() => jawRoi({ ...rig, layers: [] }, 1920, 1080)).toThrow(/no jaw layer/);
  });
});

describe.skipIf(!hasFfmpeg)("measure on a synthetic clip (ffmpeg)", () => {
  it("recovers +120 ms through H.264/AAC in FLV within one frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-measure-"));
    try {
      const file = join(dir, "syn.flv");
      await synthClip({ out: file, offsetMs: 120, seconds: 12 });
      const { report } = await measureFile({ file, roi: SYNTH_ROI }, () => undefined);
      expect(report.sync).toBeDefined();
      expect(Math.abs((report.sync?.avOffsetMs ?? 0) - 120)).toBeLessThanOrEqual(33);
      expect(report.frameMs).toBeCloseTo(33.3, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
