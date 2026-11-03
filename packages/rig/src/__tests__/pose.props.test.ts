// poseLayers properties (rig-core tasks 4.2 and 4.3, design.md "Testing strategy"): purity under
// deep-freeze, parallax from each layer's own depth and monotonic in depth across all layers
// (followers included), jaw moves only jaw layers by a bounded drop under any gesture and never
// moves the jaw's followers, hidden layers absent, followers keep their offset from the parent at
// yaw 0. Run over arbitrary valid rigs and over the committed Malakor rig (which has a head with
// followers, so the follow checks always bite).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import layersJson from "../../../../assets/characters/malakor/rig/layers.json";
import specJson from "../../../../assets/characters/malakor/rig/m8.spec.json";
import { importLegacyLayers } from "../legacy.js";
import { EMOTION_TABLE } from "../look.js";
import { JAW_DROP, poseLayers, YAW_LIMIT_DEG, YAW_SHIFT, type Drive, type LayerPose } from "../pose.js";
import type { Emotion, Gesture, Layer, LayerKind, Look, Rig } from "../types.js";
import { validateRig } from "../validate.js";
import { arbPalette, nth, rigArb } from "./arb.js";

const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];
const EMOTIONS: readonly Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];

function malakorRig(): Rig {
  const imported = importLegacyLayers(layersJson, specJson);
  if (!imported.ok) throw new Error("Malakor import failed");
  return imported.value.rig;
}
const MALAKOR = malakorRig();

/** Arbitrary rigs, with Malakor mixed in. */
const arbAnyRig = (minLayers = 0): fc.Arbitrary<Rig> => fc.oneof(rigArb({ minLayers }), fc.constant(MALAKOR));

/**
 * Uniform on a 1/10000 grid of [min, max]. fc.double spreads draws over the float encoding, so most
 * of its values are tiny magnitudes, which would leave yaw, jaw and gesture phases near zero.
 */
const between = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 10_000 }).map((i) => min + ((max - min) * i) / 10_000);
const unit = between(0, 1);
/** No gesture. Out-of-range values included: the clamps are part of the contract. */
const arbStillDrive: fc.Arbitrary<Drive> = fc.record({
  t: between(0, 1000),
  headYaw: between(-40, 40),
  headPitch: between(-30, 30),
  jawOpen: between(-0.5, 1.5),
  blink: between(-0.5, 1.5),
});
/** Sometimes a gesture from `gestures`, started from 0.1 s in the future to 0.5 s ago (past its end). */
const arbDriveWith = (gestures: readonly Gesture[]): fc.Arbitrary<Drive> =>
  fc
    .tuple(arbStillDrive, fc.option(fc.constantFrom(...gestures), { nil: undefined }), between(-0.1, 0.5))
    .map(([drive, name, elapsed]): Drive => (name === undefined ? drive : { ...drive, gesture: { name, startedAt: drive.t - elapsed } }));
const arbDrive = arbDriveWith(GESTURES);

const arbLookFor = (rig: Rig): fc.Arbitrary<Look> =>
  fc.record(
    {
      palette: arbPalette,
      hidden: fc.subarray(rig.layers.map((l) => l.name)),
      emotion: fc.constantFrom(...EMOTIONS),
      gesture: fc.constantFrom(...GESTURES),
    },
    { requiredKeys: ["palette", "hidden", "emotion"] },
  );

const arbScene = (minLayers = 0) => arbAnyRig(minLayers).chain((rig) => fc.tuple(fc.constant(rig), arbLookFor(rig), arbDrive));

const SHOW_ALL = (rig: Rig): Look => ({ palette: rig.palette, hidden: [], emotion: "neutral" });
/** The rig with every layer drawn, so each layer has a pose to inspect. */
const allVisible = (rig: Rig): Rig => ({
  ...rig,
  layers: rig.layers.map((l) => {
    const shown = { ...l };
    delete shown.visible;
    return shown;
  }),
});

/** Deep copy of plain data (keeps -0, unlike a JSON round trip). */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const byName = (poses: LayerPose[]): Map<string, LayerPose> => new Map(poses.map((p) => [p.name, p]));
function poseOf(poses: Map<string, LayerPose>, name: string): LayerPose {
  const p = poses.get(name);
  if (p === undefined) throw new Error(`no pose for ${name}`);
  return p;
}

/** Names of the layers that are, or (transitively) follow, a layer matching `match`. */
function groupOf(rig: Rig, match: (l: Layer) => boolean): Set<string> {
  const layers = new Map(rig.layers.map((l) => [l.name, l]));
  const inGroup = (l: Layer, seen: number): boolean => {
    if (match(l)) return true;
    const parent = l.follow === undefined ? undefined : layers.get(l.follow);
    return parent !== undefined && seen < rig.layers.length && inGroup(parent, seen + 1);
  };
  return new Set(rig.layers.filter((l) => inGroup(l, 0)).map((l) => l.name));
}

/** Where the pose puts canvas point `p` of its layer, using only the inheritable (uniform) part. */
function place(pose: LayerPose, layer: Layer, [px, py]: readonly [number, number]): [number, number] {
  const [ax, ay] = layer.anchor;
  const k = pose.scale[0];
  const c = Math.cos(pose.rotation) * k;
  const s = Math.sin(pose.rotation) * k;
  const [tx, ty] = [pose.x - layer.bbox[0], pose.y - layer.bbox[1]];
  return [c * (px - ax) - s * (py - ay) + ax + tx, s * (px - ax) + c * (py - ay) + ay + ty];
}

const close = (a: number, b: number, scale = 1): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, scale, Math.abs(a), Math.abs(b));
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clampYaw = (v: number): number => Math.min(YAW_LIMIT_DEG, Math.max(-YAW_LIMIT_DEG, v));
const depthOf = (l: Layer): number => l.depth ?? poseDefaultDepth(l);

const NON_JAW_KINDS: readonly LayerKind[] = ["static", "body", "head", "eye", "accessory", "crown"];

/** `base`, or `base` with underscores appended until no layer of `rig` has the name. */
function freshName(rig: Rig, base: string): string {
  const taken = new Set(rig.layers.map((l) => l.name));
  let name = base;
  while (taken.has(name)) name += "_";
  return name;
}

/**
 * A rig with a jaw that has followers: one of its jaw layers (Malakor's real jaw, which follows the
 * head), or a layer turned into a jaw when it has none, gains two appended followers, one of a
 * non-jaw kind and one jaw. Appending followers keeps the follow graph acyclic.
 */
const arbJawRig: fc.Arbitrary<Rig> = arbAnyRig(1)
  .chain((rig) =>
    fc.tuple(
      fc.constant(rig),
      fc.nat(),
      fc.constantFrom(...NON_JAW_KINDS),
      fc.option(unit, { nil: undefined }),
      fc.option(unit, { nil: undefined }),
    ),
  )
  .map(([rig, pick, kind, toothDepth, innerDepth]): Rig => {
    const jaws = rig.layers.filter((l) => l.kind === "jaw");
    const jaw = nth(jaws.length > 0 ? jaws : rig.layers, pick);
    const top = Math.max(...rig.layers.map((l) => l.z));
    const follower = (name: string, z: number, k: LayerKind, depth: number | undefined): Layer => ({
      name: freshName(rig, name),
      z,
      kind: k,
      file: `${name}.png`,
      bbox: jaw.bbox,
      anchor: [jaw.bbox[0], jaw.bbox[1]],
      follow: jaw.name,
      ...(depth === undefined ? {} : { depth }),
    });
    const layers = rig.layers.map((l): Layer => (l === jaw ? { ...l, kind: "jaw" } : l));
    return {
      ...rig,
      layers: [...layers, follower("tooth", top + 1, kind, toothDepth), follower("inner_jaw", top + 2, "jaw", innerDepth)],
    };
  });

describe("poseLayers properties", () => {
  it("is pure: deep-frozen inputs, identical outputs for identical (and cloned) inputs", () => {
    fc.assert(
      fc.property(arbScene(), ([rig, look, drive]) => {
        // Freeze a copy: `rig` may be the shared MALAKOR constant.
        const frozen = deepFreeze(clone({ rig, look, drive }));
        const first = poseLayers(frozen.rig, frozen.look, frozen.drive);
        expect(poseLayers(frozen.rig, frozen.look, frozen.drive)).toEqual(first);
        expect(poseLayers(rig, look, drive)).toEqual(first);
        expect(frozen).toEqual({ rig, look, drive });
      }),
    );
  });

  it("parallax is monotonic in depth: a deeper layer moves further with the yaw", () => {
    const scene = arbAnyRig(1).chain((rig) =>
      fc.tuple(fc.constant(allVisible(rig)), fc.nat(), unit, unit, arbStillDrive),
    );
    fc.assert(
      fc.property(scene, ([rig, pick, a, b, drive]) => {
        const i = pick % rig.layers.length;
        const [near, far] = a <= b ? [a, b] : [b, a];
        const withDepth = (depth: number) => ({ ...rig, layers: rig.layers.map((l, j) => (j === i ? { ...l, depth } : l)) });
        const name = nth(rig.layers, i).name;
        const xNear = poseOf(byName(poseLayers(withDepth(near), SHOW_ALL(rig), drive)), name).x;
        const xFar = poseOf(byName(poseLayers(withDepth(far), SHOW_ALL(rig), drive)), name).x;
        const yaw = clampYaw(drive.headYaw);
        const expected = (yaw / YAW_LIMIT_DEG) * YAW_SHIFT * rig.width * (far - near);
        expect((xFar - xNear) * Math.sign(yaw)).toBeGreaterThanOrEqual(-1e-9 * rig.width);
        expect(close(xFar - xNear, expected, rig.width)).toBe(true);
      }),
    );
  });

  it("parallax comes from each layer's own depth, monotonic across all layers (followers included) under any gesture", () => {
    const scene = arbAnyRig(2).chain((rig) => fc.tuple(fc.constant(allVisible(rig)), arbDrive));
    fc.assert(
      fc.property(scene, ([rig, drive]) => {
        const poses = byName(poseLayers(rig, SHOW_ALL(rig), drive));
        const centred = byName(poseLayers(rig, SHOW_ALL(rig), { ...drive, headYaw: 0 }));
        const perDepth = (clampYaw(drive.headYaw) / YAW_LIMIT_DEG) * YAW_SHIFT * rig.width;
        // The yaw's share of each layer's x: everything else in the drive is held fixed.
        const moved = (l: Layer): number => poseOf(poses, l.name).x - poseOf(centred, l.name).x;
        for (const l of rig.layers) {
          expect(close(moved(l), perDepth * depthOf(l), rig.width), `${l.name} parallax`).toBe(true);
          expect(poseOf(poses, l.name).y).toBe(poseOf(centred, l.name).y);
        }
        const sign = Math.sign(perDepth);
        for (const p of rig.layers) for (const q of rig.layers) {
          if (depthOf(p) < depthOf(q)) expect(moved(p) * sign, `${p.name} vs ${q.name}`).toBeLessThanOrEqual(moved(q) * sign + 1e-9 * rig.width);
        }
      }),
    );
  });

  it("jawOpen moves only jaw layers, along their turned down axis, by at most 0.06 * height under any gesture", () => {
    const scene = arbJawRig.chain((rig) => fc.tuple(fc.constant(rig), arbLookFor(rig), arbDrive, between(-0.5, 1.5)));
    fc.assert(
      fc.property(scene, ([rig, look, drive, jaw2]) => {
        expect(validateRig(rig).ok).toBe(true);
        const before = byName(poseLayers(rig, look, drive));
        const after = byName(poseLayers(rig, look, { ...drive, jawOpen: jaw2 }));
        const kinds = new Map(rig.layers.map((l) => [l.name, l.kind]));
        // The look's held jaw set (character-control "Moods") adds to jawOpen before the clamp.
        const set = EMOTION_TABLE[look.emotion].jawSet;
        const drop = (clamp01(jaw2 + set) - clamp01(drive.jawOpen + set)) * JAW_DROP * rig.height;
        for (const [name, p] of before) {
          const q = poseOf(after, name);
          // Non-jaw layers, the jaw's non-jaw followers among them, are untouched.
          if (kinds.get(name) !== "jaw") {
            expect(q, `${name} is not a jaw`).toEqual(p);
            continue;
          }
          // Every jaw, a jaw following a jaw included, drops by its own amount only.
          expect({ ...q, x: 0, y: 0 }).toEqual({ ...p, x: 0, y: 0 });
          const [dx, dy] = [q.x - p.x, q.y - p.y];
          expect(Math.hypot(dx, dy), `${name} drop`).toBeLessThanOrEqual(JAW_DROP * rig.height * (1 + 1e-9));
          expect(close(dx, -Math.sin(p.rotation) * drop, rig.height), `${name} dx`).toBe(true);
          expect(close(dy, Math.cos(p.rotation) * drop, rig.height), `${name} dy`).toBe(true);
        }
      }),
      // A tilted or scaled head over a jaw is a few percent of draws; 300 runs make a miss unlikely.
      { numRuns: 300 },
    );
  });

  it("hidden layers are absent; every other visible layer appears once, in z order", () => {
    fc.assert(
      fc.property(arbScene(), ([rig, look, drive]) => {
        const poses = poseLayers(rig, look, drive);
        const hidden = new Set(look.hidden);
        const expected = rig.layers
          .filter((l) => l.visible !== false && !hidden.has(l.name))
          .sort((a, b) => a.z - b.z)
          .map((l) => l.name);
        expect(poses.map((p) => p.name)).toEqual(expected);
        for (const p of poses) expect(hidden.has(p.name)).toBe(false);
      }),
    );
  });

  it("followers keep their offset from the parent at yaw 0 (rotated and scaled with it)", () => {
    // `still`: a layer's own float (cast-forge, Malakor's shards) moves it off the follow offset by design.
    const still = arbDriveWith(GESTURES.filter((g) => g !== "nod")).map((d): Drive => ({ ...d, headYaw: 0, headPitch: 0, jawOpen: 0, still: true }));
    const scene = arbAnyRig(2).chain((rig) => fc.tuple(fc.constant(allVisible(rig)), still));
    fc.assert(
      fc.property(scene, ([rig, drive]) => {
        const poses = byName(poseLayers(rig, SHOW_ALL(rig), drive));
        const layers = new Map(rig.layers.map((l) => [l.name, l]));
        const headGroup = groupOf(rig, (l) => l.kind === "head");
        for (const child of rig.layers) {
          const parent = child.follow === undefined ? undefined : layers.get(child.follow);
          if (parent === undefined) continue;
          // A head on a non-head parent is where head gestures start; it moves on its parent by design.
          if (child.kind === "head" && !headGroup.has(parent.name)) continue;
          const c = poseOf(poses, child.name);
          const p = poseOf(poses, parent.name);
          const [cx, cy] = place(c, child, child.anchor);
          const [ex, ey] = place(p, parent, child.anchor);
          const size = Math.max(rig.width, rig.height, ...child.anchor.map(Math.abs));
          expect(close(cx, ex, size) && close(cy, ey, size), `${child.name} follows ${parent.name}`).toBe(true);
          expect(close(c.rotation, p.rotation)).toBe(true);
          expect(close(c.scale[0], p.scale[0])).toBe(true);
        }
      }),
    );
  });
});

/** Mirror of DEFAULT_DEPTH, kept literal so the test checks the design table, not the code. */
function poseDefaultDepth(l: Layer): number {
  const table: Record<Layer["kind"], number> = { static: 0, body: 0.3, head: 0.6, jaw: 0.62, eye: 0.7, accessory: 0.75, crown: 0.65 };
  return table[l.kind];
}
