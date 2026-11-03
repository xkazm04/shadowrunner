// Moods, faces and reshape in poseLayers (character-control task 1, design.md "Moods", "Reshape";
// requirements 3.1, 4.1-4.4) on a fixture rig with a head, eyes, a jaw, an emissive crown and
// brow_l / brow_r, plus Reveille (brow layers) and Malakor (none) for hasBrowLayers.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import reveilleJob from "../../../../assets/replay/forge/reveille/job.json";
import { importLegacyLayers } from "../legacy.js";
import { EMOTION_TABLE, moodDrive, MOOD_COLUMNS, smoothstep } from "../look.js";
import { BROW_TILT_DEG_PER_LIFT, facesOf, hasBrowLayers, isBrowLayer } from "../mood.js";
import { poseLayers, type Drive, type LayerPose } from "../pose.js";
import type { Emotion, Layer, Look, PartShape, Rig } from "../types.js";
import { validateRig } from "../validate.js";

const W = 1000;
const H = 800;
const EMOTIONS = Object.keys(EMOTION_TABLE) as Emotion[];
const REST: Drive = { t: 10, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };
const PALETTE = { glow: "#000000", eye: "#000000", rim: "#000000", mouth: "#000000" };
const look = (emotion: Emotion, extra: Partial<Look> = {}): Look => ({ palette: PALETTE, hidden: [], emotion, ...extra });

const layer = (name: string, z: number, kind: Layer["kind"], bbox: Layer["bbox"], anchor: Layer["anchor"], extra: Partial<Layer> = {}): Layer => ({
  name,
  z,
  kind,
  file: `${name}.png`,
  bbox,
  anchor,
  ...extra,
});

const PATCH = { file: "x.png", bbox: [400, 250, 100, 60] as [number, number, number, number], mode: "replace" as const };

/** Head (depth 0.6) with jaw at the same depth (so a pitch moves both alike), eyes, brows, a crown. */
const RIG: Rig = {
  version: 1,
  id: "fixture",
  name: "Fixture",
  width: W,
  height: H,
  source: "replay",
  fictional: true,
  palette: PALETTE,
  layers: [
    layer("torso", 0, "body", [300, 500, 400, 300], [500, 650]),
    layer("head", 1, "head", [300, 100, 400, 450], [500, 400]),
    layer("jaw", 2, "jaw", [400, 420, 200, 100], [500, 430], { follow: "head", depth: 0.6 }),
    layer("eye_l", 3, "eye", [540, 260, 60, 40], [570, 280], { follow: "head", variants: { anger: PATCH, joy: PATCH } }),
    layer("eye_r", 4, "eye", [400, 260, 60, 40], [430, 280], { follow: "head" }),
    layer("brow_l", 5, "accessory", [530, 220, 90, 30], [545, 235], { follow: "head", depth: 0.6, emissive: false }),
    layer("brow_r", 6, "accessory", [380, 220, 90, 30], [455, 235], { follow: "head", depth: 0.6, emissive: false }),
    layer("crown", 7, "crown", [350, 20, 300, 100], [500, 110], { follow: "head" }),
  ],
};

const byName = (poses: LayerPose[]): Map<string, LayerPose> => new Map(poses.map((p) => [p.name, p]));
const at = (l: Look, drive: Partial<Drive> = {}, rig: Rig = RIG): Map<string, LayerPose> => byName(poseLayers(rig, l, { ...REST, ...drive }));
function get(poses: Map<string, LayerPose>, name: string): LayerPose {
  const p = poses.get(name);
  if (p === undefined) throw new Error(`no pose for ${name}`);
  return p;
}

/** The six mood channels, measured so each moves only with its own column. */
type Channel = "tilt" | "pitch" | "squint" | "jaw" | "glow" | "brow";
function channels(poses: Map<string, LayerPose>): Record<Channel, number> {
  const head = get(poses, "head");
  const jaw = get(poses, "jaw");
  const eye = get(poses, "eye_r");
  const brow = get(poses, "brow_l");
  return {
    tilt: head.rotation,
    pitch: get(poses, "torso").y,
    squint: eye.scale[1] / eye.scale[0],
    // Posed anchors: head (500, 400) and jaw (500, 430) share a depth, so only the drop moves this.
    jaw: Math.hypot(jaw.x + 100 - (head.x + 200), jaw.y + 10 - (head.y + 300)),
    glow: get(poses, "crown").tint,
    brow: brow.rotation - head.rotation,
  };
}

describe("moods (req 4.1): held procedural values per the design table", () => {
  const neutral = channels(at(look("neutral")));

  it.each(EMOTIONS.filter((e) => e !== "neutral"))("%s moves at least 3 of the 6 channels vs neutral", (emotion) => {
    const moved = Object.entries(channels(at(look(emotion)))).filter(([key, v]) => Math.abs(v - neutral[key as Channel]) > 1e-9);
    expect(moved.length, moved.map(([k]) => k).join(",")).toBeGreaterThanOrEqual(3);
  });

  it("holds the mood long after any gesture (not a 0.4 s pulse)", () => {
    expect(channels(at(look("furious"), { t: 500 }))).toEqual(channels(at(look("furious"), { t: 10 })));
  });

  it("turns the head group by headTilt degrees, and its followers with it", () => {
    const p = at(look("bored"));
    expect(get(p, "head").rotation).toBeCloseTo((5 * Math.PI) / 180, 12);
    expect(get(p, "eye_l").rotation).toBeCloseTo((5 * Math.PI) / 180, 12);
  });

  it("adds headPitch before the clamp, and jawSet to jawOpen clamped to 1", () => {
    expect(channels(at(look("furious"), { headPitch: 12 })).pitch).toBe(channels(at(look("neutral"), { headPitch: 12 })).pitch);
    expect(channels(at(look("theatrical"), { jawOpen: 1 })).jaw).toBeCloseTo(channels(at(look("neutral"), { jawOpen: 1 })).jaw, 9);
  });

  it("combines squint with blink as 1 - (1 - blink squash)(1 - squint)", () => {
    const eye = get(at(look("suspicious"), { blink: 0.5 }), "eye_r");
    expect(eye.scale[1]).toBeCloseTo((1 - 0.9 * 0.5) * (1 - 0.4), 12);
  });

  it("multiplies glowGain into emissive layers only", () => {
    const p = at(look("furious"));
    expect(get(p, "crown").tint).toBeCloseTo(1.6, 12);
    expect(get(p, "eye_r").tint).toBeCloseTo(1.6, 12);
    expect(get(p, "brow_l").tint).toBe(1);
    expect(get(p, "torso").tint).toBe(1);
  });

  it("lifts brow layers by browLift * height and tilts them into a V when negative", () => {
    const [n, f] = [at(look("neutral")), at(look("furious"))];
    for (const brow of ["brow_l", "brow_r"]) {
      const rise = get(f, brow).y - get(f, "head").y - (get(n, brow).y - get(n, "head").y);
      expect(rise).toBeCloseTo(0.012 * H, 9);
    }
    // brow_r sits on screen left: its inner (right) end goes down, a clockwise (positive) turn.
    const deg = (0.012 * BROW_TILT_DEG_PER_LIFT * Math.PI) / 180;
    expect(get(f, "brow_r").rotation).toBeCloseTo(deg, 12);
    expect(get(f, "brow_l").rotation).toBeCloseTo(-deg, 12);
    expect(get(at(look("theatrical")), "brow_r").rotation).toBeLessThan(0);
  });

  it("hasBrowLayers: Reveille has brow_l/brow_r, Malakor has none (the renderer's eye fallback)", () => {
    const reveille = validateRig((reveilleJob as { rig: unknown }).rig);
    const malakor = importLegacyLayers(layersJson, specJson);
    if (!reveille.ok || !malakor.ok) throw new Error("fixtures");
    expect(hasBrowLayers(reveille.value)).toBe(true);
    expect(hasBrowLayers(malakor.value.rig)).toBe(false);
    expect(["brow", "brow_l", "brow_2", "browl", "eyebrow"].map((name) => isBrowLayer({ name }))).toEqual([true, true, true, false, false]);
  });

  it("reduced motion (still) does not stop the mood", () => {
    const still = { still: true as const };
    expect(channels(at(look("grim"), still))).not.toEqual(channels(at(look("neutral"), still)));
    expect(channels(at(look("grim"), still))).toEqual(channels(at(look("grim"))));
  });
});

describe("crossfade (req 4.3): Drive.mood blends every column by smoothstep(mix)", () => {
  it("mix 0 is the from emotion, mix 1 (or no mood) the look's", () => {
    const fromTo = (mix: number): LayerPose[] => poseLayers(RIG, look("furious"), { ...REST, mood: { from: "amused", mix } });
    expect(fromTo(0)).toEqual(poseLayers(RIG, look("amused"), REST));
    expect(fromTo(1)).toEqual(poseLayers(RIG, look("furious"), REST));
  });

  it("is halfway at mix 0.5 and clamps mix", () => {
    expect(smoothstep(0.5)).toBe(0.5);
    expect([smoothstep(-1), smoothstep(2), smoothstep(Number.NaN)]).toEqual([0, 1, 1]);
    const mid = moodDrive("theatrical", { from: "bored", mix: 0.5 });
    for (const c of MOOD_COLUMNS) expect(mid[c]).toBeCloseTo((EMOTION_TABLE.bored[c] + EMOTION_TABLE.theatrical[c]) / 2, 12);
    expect(mid.gesture).toBe("flare");
  });

  it("every blended column lies between from and to (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...EMOTIONS), fc.constantFrom(...EMOTIONS), fc.double({ min: -1, max: 2, noNaN: true }), (from, to, mix) => {
        const d = moodDrive(to, { from, mix });
        for (const c of MOOD_COLUMNS) {
          const [a, b] = [EMOTION_TABLE[from][c], EMOTION_TABLE[to][c]];
          expect(d[c]).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-12);
          expect(d[c]).toBeLessThanOrEqual(Math.max(a, b) + 1e-12);
        }
      }),
    );
  });
});

describe("faces (req 4.2, design.md 'Faces')", () => {
  const eye = RIG.layers.find((l) => l.name === "eye_l") as Layer;
  const weightSum = (faces: LayerPose["faces"]): number => (faces ?? []).reduce((s, f) => s + f.weight, 0);

  it("lists the outgoing and incoming families by 1 - m and m, summing to 1", () => {
    const faces = facesOf(eye, look("furious"), { from: "amused", mix: 0.3 });
    const m = smoothstep(0.3);
    expect(faces).toEqual([
      { family: "joy", weight: 1 - m },
      { family: "anger", weight: m },
    ]);
    expect(weightSum(faces)).toBeCloseTo(1, 12);
  });

  it("settled: the family alone at weight 1; neutral or a family without a variant: omitted", () => {
    expect(get(at(look("irritated")), "eye_l").faces).toEqual([{ family: "anger", weight: 1 }]);
    expect("faces" in get(at(look("neutral")), "eye_l")).toBe(false);
    expect("faces" in get(at(look("smug")), "eye_l")).toBe(false);
    expect("faces" in get(at(look("furious")), "eye_r")).toBe(false);
    expect(facesOf(eye, look("furious"), { from: "neutral", mix: 0.5 })).toEqual([{ family: "anger", weight: 0.5 }]);
  });

  it("one family on both sides (amused -> delighted) stays at weight 1", () => {
    expect(facesOf(eye, look("delighted"), { from: "amused", mix: 0.4 })).toEqual([{ family: "joy", weight: 1 }]);
  });

  it("weights are in (0, 1] and sum to at most 1 for any crossfade (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...EMOTIONS), fc.constantFrom(...EMOTIONS), fc.double({ min: 0, max: 1, noNaN: true }), (from, to, mix) => {
        const faces = facesOf(eye, look(to), { from, mix });
        for (const f of faces ?? []) expect(f.weight > 0 && f.weight <= 1).toBe(true);
        expect(weightSum(faces)).toBeLessThanOrEqual(1 + 1e-12);
      }),
    );
  });
});

describe("reshape (req 3.1, design.md 'Reshape')", () => {
  const shaped = (shape: Record<string, Partial<PartShape>>): Map<string, LayerPose> => at(look("neutral", { shape: shape as Record<string, PartShape> }));
  const full = (s: Partial<PartShape>): PartShape => ({ size: 1, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0, ...s });
  const anchorOf = (p: LayerPose, name: string): [number, number] => {
    const l = RIG.layers.find((x) => x.name === name) as Layer;
    return [l.anchor[0] + p.x - l.bbox[0], l.anchor[1] + p.y - l.bbox[1]];
  };

  it("scales, turns and moves a part about its anchor, and its followers inherit it", () => {
    const p = shaped({ head: full({ size: 1.5, rot: 10, dx: 0.1, dy: -0.05 }) });
    const head = get(p, "head");
    expect(head.scale).toEqual([1.5, 1.5]);
    expect(head.rotation).toBeCloseTo((10 * Math.PI) / 180, 12);
    expect(anchorOf(head, "head")).toEqual([500 + 0.1 * W, 400 - 0.05 * W].map((v) => expect.closeTo(v, 9)));
    // The eye's anchor (570, 280) is (70, -120) from the head's: scaled 1.5, turned 10 degrees, moved.
    const r = (10 * Math.PI) / 180;
    const [ox, oy] = [1.5 * (70 * Math.cos(r) + 120 * Math.sin(r)), 1.5 * (70 * Math.sin(r) - 120 * Math.cos(r))];
    expect(anchorOf(get(p, "eye_l"), "eye_l")).toEqual([600 + ox, 350 + oy].map((v) => expect.closeTo(v, 9)));
    expect(get(p, "eye_l").scale).toEqual([1.5, 1.5]);
    expect(get(p, "eye_l").rotation).toBeCloseTo(r, 12);
  });

  it("stretches on its own axes and passes the stretch down", () => {
    const p = shaped({ head: full({ sx: 1.4, sy: 0.8 }) });
    expect(get(p, "head").scale).toEqual([1.4, 0.8]);
    expect(anchorOf(get(p, "eye_l"), "eye_l")).toEqual([500 + 70 * 1.4, 400 - 120 * 0.8].map((v) => expect.closeTo(v, 9)));
    expect(get(p, "eye_l").scale).toEqual([1.4, 0.8]);
  });

  it("clamps an out-of-range or broken saved shape (clampShape)", () => {
    const p = shaped({ crown: { size: 9, sx: 0.1, sy: Number.NaN, dx: 4, dy: -4, rot: 300 } });
    const crown = get(p, "crown");
    expect(crown.scale.map((v) => +v.toFixed(12))).toEqual([1.6 * 0.6, 1.6]);
    expect(crown.rotation).toBeCloseTo((25 * Math.PI) / 180, 12);
    expect(anchorOf(crown, "crown")).toEqual([500 + 0.15 * W, 110 - 0.15 * W].map((v) => expect.closeTo(v, 9)));
  });

  it("a layer with no entry poses exactly as today; a gesture turns a reshaped head about its moved anchor", () => {
    const plain = at(look("neutral"));
    const p = shaped({ crown: full({ size: 1.2 }) });
    for (const name of ["torso", "head", "jaw", "eye_l", "eye_r", "brow_l", "brow_r"]) expect(get(p, name)).toEqual(get(plain, name));
    const tilt: Partial<Drive> = { gesture: { name: "tilt", startedAt: REST.t - 0.2 } };
    const moved = at(look("neutral", { shape: { head: full({ dx: 0.1 }) } }), tilt);
    expect(anchorOf(get(moved, "head"), "head")).toEqual([600, 400].map((v) => expect.closeTo(v, 9)));
  });
});
