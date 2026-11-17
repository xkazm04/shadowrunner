// forge-pkg B, the cast forecast: what each provisional draft becomes once paid. Eyes are read by
// `socketEyes` with no edit (the live eye step's fallback) and the forecast is conservative: an eye it
// says follows chat is socketed by the clean-edit path too (property over the eyes.test painter). Acts
// land only on a non-empty layer of the cut. `recommendDraft` names one cut draft or none; replay
// derives the forecast from the recorded rig's iris layers; readers drop a malformed forecast only.
import type { Layer, Rig } from "@sr/rig";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replayCastView, type RecordedCandidate } from "./cast.js";
import { castForecast, forecastLines, readCastForecast, recommendDraft } from "./castForecast.js";
import { castRecordOf, type CastBatch } from "./castJob.js";
import { socketEyes } from "./faceEyes.js";
import type { Iris } from "./eyes.js";
import type { Rgba } from "./types.js";
import type { BriefPart, CastForecast } from "./wire.js";

// The eyes.test painter: an 80 x 50 eye, skin, a lid line, whites, an iris with a pupil and a highlight.
const W = 80;
const H = 50;
const SKIN = [196, 156, 136] as const;
const inOpening = (x: number, y: number, ry: number) => ((x + 0.5 - 40) / 30) ** 2 + ((y + 0.5 - 25) / ry) ** 2 <= 1;
function paint(iris: Iris, ry = 13, withIris = true): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c: readonly number[] = SKIN;
      const open = inOpening(x, y, ry);
      if (!open && inOpening(x, y, ry + 2.5)) c = [60, 40, 36];
      if (open) {
        const d = Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy);
        c = withIris && d <= iris.r ? (d <= iris.r * 0.35 ? [14, 14, 20] : [60, 110, 170]) : [236, 234, 228];
        if (withIris && Math.hypot(x + 0.5 - iris.cx + 2, y + 0.5 - iris.cy + 2) <= 1.2) c = [250, 250, 250];
      }
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}
const solid = (w: number, h: number, rgba: readonly number[]): Rgba => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => rgba[i % 4] ?? 0) });

const CANVAS = { w: 200, h: 80 };
const BOXES: Record<string, Layer["bbox"]> = { head: [0, 0, 200, 80], eye_r: [10, 15, W, H], eye_l: [110, 15, W, H], hand_r: [90, 60, 20, 20] };
function rigOf(names: readonly string[]): Rig {
  const kind = (n: string): Layer["kind"] => (n === "head" ? "head" : n.startsWith("eye") ? "eye" : "accessory");
  return {
    version: 1, id: "t", name: "T", width: CANVAS.w, height: CANVAS.h, source: "forge",
    palette: { glow: "#ffffff", eye: "#ffffff", rim: "#ffffff", mouth: "#000000" },
    layers: names.map((name, i) => ({ name, kind: kind(name), z: i + 1, file: `${name}.png`, bbox: BOXES[name] ?? [0, 0, 1, 1], anchor: [0, 0], ...(kind(name) === "eye" ? { emissive: false } : {}) })),
  };
}
const I1: Iris = { cx: 40, cy: 25, r: 9 };
const I2: Iris = { cx: 31.5, cy: 24, r: 8 };
function images(eyes: { eye_r?: Rgba; eye_l?: Rgba }, hand: Rgba = solid(20, 20, [200, 40, 40, 255])): Record<string, Rgba> {
  return { "head.png": solid(200, 80, [196, 156, 136, 255]), "eye_r.png": eyes.eye_r ?? paint(I1), "eye_l.png": eyes.eye_l ?? paint(I2), "hand_r.png": hand };
}
/** The iris-free edit of the portrait (canvas size): each eye painted without its iris, at its box. */
function cleanCanvas(eyes: Record<string, Rgba>): Rgba {
  const out = solid(CANVAS.w, CANVAS.h, [196, 156, 136, 255]);
  for (const [name, img] of Object.entries(eyes)) {
    const [bx, by] = BOXES[name] ?? [0, 0];
    for (let y = 0; y < img.height; y++) out.data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((by + y) * CANVAS.w + bx) * 4);
  }
  return out;
}

const SLAM: BriefPart[] = [
  { name: "head", role: "head", what: "a head" },
  { name: "hand_r", role: "accessory", what: "a gavel hand", motion: "slams on 'sold'" },
];
const RIG = rigOf(["head", "eye_r", "eye_l", "hand_r"]);

describe("castForecast", () => {
  it("readable irises: both eyes follow chat (socketEyes with no edit, the live fallback)", () => {
    const f = castForecast(RIG, images({}), { parts: SLAM });
    expect(f.eyes).toEqual({ follow: ["eye_r", "eye_l"], painted: [] });
  });

  it("an eye socketEyes cannot read (a flat blob) stays painted", () => {
    const rig = rigOf(["head", "eye_r", "hand_r"]).layers.map((l) => (l.name === "eye_r" ? { ...l, name: "eye", file: "eye.png" } : l));
    const f = castForecast({ ...RIG, layers: rig }, { ...images({}), "eye.png": solid(W, H, [120, 90, 80, 255]) }, { parts: SLAM });
    expect(f.eyes).toEqual({ follow: [], painted: ["eye"] });
  });

  it("an act lands on a non-empty layer; missing or empty in the cut, it is lost", () => {
    expect(castForecast(RIG, images({}), { parts: SLAM }).acts).toMatchObject({ land: ["hand_r"], lost: [] });
    const without = rigOf(["head", "eye_r", "eye_l"]);
    expect(castForecast(without, images({}), { parts: SLAM }).acts).toMatchObject({ land: [], lost: ["hand_r"] });
    expect(castForecast(RIG, images({}, solid(20, 20, [0, 0, 0, 0])), { parts: SLAM }).acts).toMatchObject({ land: [], lost: ["hand_r"] });
  });

  it("conservative (property): no eye in follow is left painted by socketEyes with the clean edit", () => {
    const iris = fc.record({ cx: fc.integer({ min: 22, max: 58 }), cy: fc.integer({ min: 20, max: 30 }), r: fc.integer({ min: 6, max: 11 }) });
    fc.assert(
      fc.property(iris, iris, fc.integer({ min: 8, max: 15 }), fc.boolean(), (a, b, ry, blob) => {
        const eyes = { eye_r: blob ? solid(W, H, [120, 90, 80, 255]) : paint(a, ry), eye_l: paint(b, ry) };
        const imgs = images(eyes);
        const clean = cleanCanvas({ eye_r: blob ? eyes.eye_r : paint(a, ry, false), eye_l: paint(b, ry, false) });
        const withEdit = new Set(socketEyes(RIG, imgs, { clean }).eyes.map((e) => e.name));
        for (const eye of castForecast(RIG, imgs, { parts: SLAM }).eyes.follow) expect(withEdit.has(eye), eye).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});

const F = (follow: number, painted: number, land = 1, lost = 0): CastForecast => ({
  eyes: { follow: ["eye_r", "eye_l"].slice(0, follow), painted: ["eye_r", "eye_l"].slice(follow, follow + painted) },
  acts: { land: ["hand_r"].slice(0, land), lost: ["hat"].slice(0, lost), cues: { hand_r: ["sold"] } },
});
const CUT = { state: "cut" as const };

describe("recommendDraft", () => {
  it("names the one cut draft whose eyes follow and whose every act lands", () => {
    expect(recommendDraft([F(0, 2), F(2, 0), F(0, 2)], [CUT, CUT, CUT])).toEqual({ index: 1, reason: "eyes follow chat, every act lands" });
  });

  it("none on a tie, and never an uncut or failed slot", () => {
    expect(recommendDraft([F(2, 0), F(2, 0), F(2, 0)], [CUT, CUT, CUT])).toBeUndefined();
    expect(recommendDraft([F(0, 2), F(2, 0), F(0, 2)], [CUT, { state: "uncut" }, CUT])).toBeUndefined();
    expect(recommendDraft([F(0, 2), F(2, 0), undefined], [CUT, { state: "failed" }, { state: "failed" }])).toBeUndefined();
  });
});

describe("forecastLines", () => {
  it("says the eyes conservatively and the acts with their cues", () => {
    expect(forecastLines(F(2, 0))).toEqual(["At least 2 of 2 eyes follow chat.", 'Acts that land: hand_r on "sold".']);
    expect(forecastLines(F(0, 1, 0, 1))).toEqual(["No eye is sure to follow chat; eye r may stay painted.", "Acts with no layer to land on: hat."]);
  });
});

describe("replay and records", () => {
  it("replayCastView: a recorded rig's iris layers say which eyes follow (no pixels)", () => {
    const base = rigOf(["head", "eye_r", "eye_l"]);
    const iris: Layer = { name: "iris_r", kind: "iris", z: 4, file: "iris_r.png", bbox: [40, 30, 10, 10], anchor: [45, 35], follow: "eye_r" };
    const job: RecordedCandidate = { slug: "a", portraitUrl: "/a.png", rig: { ...base, layers: [...base.layers, iris] }, assets: {} };
    const view = replayCastView("id", { round: 0, startedAt: 0, slugs: ["a"], primary: false }, new Map([["a", job]]), 5000);
    expect(view?.candidates[0]?.forecast?.eyes).toEqual({ follow: ["eye_r"], painted: ["eye_l"] });
  });

  const batch = (forecast: unknown): unknown => ({
    jobId: "a".repeat(32), kind: "batch", plane: "live", status: "ready", createdAt: 1, round: 0,
    brief: { name: "Brine", one_line_request: "an iron diving helmet", archetype: "Diver", persona_hook: "Hums.", accent_hex: "#38c8ff", silhouette: "Round.", parts: [{ name: "helmet", role: "head", what: "helmet" }, { name: "jaw", role: "jaw", what: "lip" }, { name: "eye_l", role: "eye_l", what: "eye" }, { name: "eye_r", role: "eye_r", what: "eye" }, { name: "hose", role: "float", what: "hose" }, { name: "suit", role: "torso", what: "suit" }], style: { name: "Low-poly 3D", why: "Planes." }, portrait_prompt: "A helmet." },
    slots: [{ state: "cut", missing: [], empty: [], warnings: [], forecast }],
  });

  it("castRecordOf: a well-formed forecast round-trips; a malformed one is dropped, the slot kept", () => {
    const good = castRecordOf(batch(F(2, 0))) as CastBatch | undefined;
    expect(good?.slots[0]?.forecast).toEqual(F(2, 0));
    const bad = castRecordOf(batch({ eyes: { follow: "eye_r" }, acts: {} })) as CastBatch | undefined;
    expect(bad?.slots).toHaveLength(1);
    expect(bad?.slots[0]).not.toHaveProperty("forecast");
    expect(readCastForecast({ eyes: { follow: [], painted: [] }, acts: { land: ["x"], lost: [], cues: { x: [1] } } })).toBeUndefined();
  });
});
