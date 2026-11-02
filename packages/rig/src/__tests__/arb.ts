// fast-check arbitraries for valid Rig v1 values (rig-core task 2.1).
// Every rig generated here must pass validateRig; the round-trip property relies on it.
// Coordinates are multiples of 1/4 px so bbox sums are exact in binary floating point, and no
// generator yields -0 (JSON writes it as 0, which would break deep equality after a round trip).
import fc from "fast-check";
import type { FloatMotion, Layer, LayerKind, Motion, Palette, PulseMotion, Rig } from "../types.js";

export const LAYER_KINDS: readonly LayerKind[] = ["static", "body", "head", "jaw", "eye", "accessory", "crown"];
export const SOURCES: readonly Rig["source"][] = ["forge", "replay", "import"];
export const PALETTE_KEYS: readonly (keyof Palette)[] = ["glow", "eye", "rim", "mouth"];

/** "#rrggbb", in lower or upper case. */
export const arbHex: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 0xffffff }), fc.boolean())
  .map(([n, upper]) => {
    const digits = n.toString(16).padStart(6, "0");
    return `#${upper ? digits.toUpperCase() : digits}`;
  });

export const arbPalette: fc.Arbitrary<Palette> = fc.record({ glow: arbHex, eye: arbHex, rim: arbHex, mouth: arbHex });

export const arbLayerName: fc.Arbitrary<string> = fc.stringMatching(/^[a-z0-9_]{1,12}$/);

/** A [start, length] span inside [0, size] with length > 0, in quarter pixels. */
function arbSpan(size: number): fc.Arbitrary<[start: number, length: number]> {
  const quarters = size * 4;
  return fc
    .tuple(fc.integer({ min: 0, max: quarters }), fc.integer({ min: 0, max: quarters }))
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => (a < b ? [a / 4, (b - a) / 4] : [b / 4, (a - b) / 4]));
}

/** Anchors are not bounds-checked, so they may sit anywhere from one canvas before to one after. */
function arbCoord(size: number): fc.Arbitrary<number> {
  return fc.integer({ min: -4 * size, max: 8 * size }).map((q) => q / 4);
}

type LayerBody = Omit<Layer, "name" | "z" | "follow">;

/** `i / steps` of the way from `min` to `max` (both included), on a grid: no -0, exact ends. */
const grid = (min: number, max: number, steps = 1000): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: steps }).map((i) => (i === steps ? max : min + ((max - min) * i) / steps));
/** Phase in [0, 1). */
export const arbPhase: fc.Arbitrary<number> = fc.integer({ min: 0, max: 9999 }).map((i) => i / 10_000);
export const arbFreq: fc.Arbitrary<number> = grid(0.02, 2);

/** In-range float for a `width` x `height` canvas (cast-forge design "Motion"), ends included. */
export function arbFloat(width: number, height: number): fc.Arbitrary<FloatMotion> {
  return fc.record(
    { amp: fc.tuple(grid(0, 0.05 * width), grid(0, 0.05 * height)), freq: arbFreq, rot_deg: grid(0, 15), phase: arbPhase },
    { requiredKeys: ["amp", "freq"] },
  );
}
export const arbPulse: fc.Arbitrary<PulseMotion> = fc.record({ amp: grid(0, 1), freq: arbFreq, phase: arbPhase }, { requiredKeys: ["amp", "freq"] });

export function arbMotion(width: number, height: number): fc.Arbitrary<Motion> {
  return fc.record({ float: arbFloat(width, height), pulse: arbPulse }, { requiredKeys: [] });
}

// Built once: fc.stringMatching is costly to construct, and rigArb rebuilds per-canvas parts
// inside `chain` for every sample.
const arbKind = fc.constantFrom(...LAYER_KINDS);

/**
 * A relative POSIX path inside the rig folder (task 3.0): one to three non-empty segments of any
 * characters except `/`, `\` and `:`, none of them `..`.
 */
const arbSegment = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s !== ".." && !/[/\\:]/.test(s));
export const arbRelativeFile: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("/"));

const arbFile = fc.oneof(
  fc.stringMatching(/^[a-z0-9_]{1,10}\.png$/),
  fc.constant("data:image/png;base64,iVBORw0KGgo="),
  arbRelativeFile,
);
const arbDepth = fc.double({ min: 0, max: 1, noNaN: true });
const arbRigHead = fc.record(
  {
    id: fc.stringMatching(/^[a-z0-9-]{1,16}$/),
    name: fc.string(),
    source: fc.constantFrom(...SOURCES),
    fictional: fc.constant(true),
    palette: arbPalette,
  },
  { requiredKeys: ["id", "name", "source", "palette"] },
);

function arbLayerBody(width: number, height: number, motion: boolean): fc.Arbitrary<LayerBody> {
  return fc.record(
    {
      ...(motion ? { motion: arbMotion(width, height) } : {}),
      kind: arbKind,
      file: arbFile,
      bbox: fc.tuple(arbSpan(width), arbSpan(height)).map(([[x, w], [y, h]]): Layer["bbox"] => [x, y, w, h]),
      anchor: fc.tuple(arbCoord(width), arbCoord(height)),
      depth: arbDepth,
      visible: fc.constant(false),
    },
    { requiredKeys: ["kind", "file", "bbox", "anchor"] },
  );
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

export interface RigArbOptions {
  minLayers?: number;
  maxLayers?: number;
  /** Layers may carry an in-range `motion` (cast-forge); off by default. */
  motion?: boolean;
}

/**
 * Valid rigs: unique names and z values, every bbox inside the canvas, and an acyclic follow
 * graph (a layer only follows a layer of strictly lower rank in a random ranking, so parents can
 * appear before or after their followers in `layers`).
 */
export function rigArb({ minLayers = 0, maxLayers = 10, motion = false }: RigArbOptions = {}): fc.Arbitrary<Rig> {
  const canvas = fc.record({ width: fc.integer({ min: 1, max: 4096 }), height: fc.integer({ min: 1, max: 4096 }) });
  return fc.tuple(canvas, fc.uniqueArray(arbLayerName, { minLength: minLayers, maxLength: maxLayers })).chain(
    ([{ width, height }, names]) => {
      const n = names.length;
      return fc
        .record({
          zs: fc.uniqueArray(fc.integer({ min: -1000, max: 1000 }), { minLength: n, maxLength: n }),
          bodies: fc.array(arbLayerBody(width, height, motion), { minLength: n, maxLength: n }),
          follows: fc.array(fc.option(fc.nat(), { nil: undefined }), { minLength: n, maxLength: n }),
          ranking: fc.shuffledSubarray(range(n), { minLength: n, maxLength: n }),
          head: arbRigHead,
        })
        .map(({ zs, bodies, follows, ranking, head }): Rig => {
          const rank = (i: number): number => ranking.indexOf(i);
          const layers = bodies.map((body, i): Layer => {
            const parents = names.filter((_, j) => rank(j) < rank(i));
            const pick = follows[i];
            const follow = pick === undefined || parents.length === 0 ? undefined : nth(parents, pick);
            return { name: nth(names, i), z: nth(zs, i), ...body, ...(follow === undefined ? {} : { follow }) };
          });
          return { version: 1, ...head, width, height, layers };
        });
    },
  );
}

export const arbRig: fc.Arbitrary<Rig> = rigArb();

/** Picks an element by an arbitrary natural number; the array must be non-empty. */
export function nth<T>(items: readonly T[], pick: number): T {
  const item = items[pick % items.length];
  if (item === undefined) throw new Error("nth: empty array");
  return item;
}
