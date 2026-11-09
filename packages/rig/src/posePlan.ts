// What poseLayers derives from a rig's layers alone, built once per layers array, and the scratch
// it reuses every frame (perfection-pass P1: a steady frame allocates little beyond its output),
// with the two passes that fill it from layer motion (moved out of pose.ts for the line cap).
// Internal to the package (not exported from index.ts).
//
// Decisions:
// - Poses key layers by name and the first layer of a name wins (`layerIndex`), so per-layer state
//   lives in "slots": a layer's slot is the index of the first layer with its name. Two layers of
//   one name share a slot, exactly as they shared a Map entry before.
// - The scratch arrays are valid only inside one poseLayers call. poseLayers never re-enters (it
//   calls nothing that poses), so one set per layers array is safe; every call clears it first.
// - Rigs are not mutated (the same rule `layerIndex` relies on): a changed rig is a new layers array.
import { actMotionAt } from "./act.js";
import { eyeOf, layerIndex } from "./eyes.js";
import { NO_MOTION, type MotionOffset } from "./motion.js";
import type { Drive } from "./pose.js";
import { apply, compose, IDENTITY, turnAbout, type Sim } from "./sim.js";
import type { Layer, Rig } from "./types.js";

/** A layer's gesture world transform and what has already reached it down its follow chain. */
export interface World {
  /** Gesture-only world transform: the part followers inherit. */
  sim: Sim;
  /** The layer is a head or follows one, so a head-group gesture already reached it. */
  headed: boolean;
  /** The layer is a head or body or follows one, so the breath already reached it. */
  breathed: boolean;
}

/** One layer in draw order: its rig index and, for an iris, the eye it rides. */
export interface PlanEntry {
  layer: Layer;
  index: number;
  eye: Layer | undefined;
}

export interface PosePlan {
  /** Per layer index, its slot (the index of the first layer with its name). */
  slot: Int32Array;
  /** Per layer index, the slot of its `follow` parent, or -1 (none, or a name no layer has). */
  parent: Int32Array;
  /** Every layer in `z` order (ties keep rig order), before any look hides one. */
  order: readonly PlanEntry[];
  /** Scratch, per slot: the resolved world (undefined = not yet this call). */
  worlds: (World | undefined)[];
  /** Scratch, per slot: the carried float (undefined = not yet this call). */
  carries: (Sim | undefined)[];
  /** Scratch, per slot: 1 while the slot is on the resolve stack (a follow cycle stops there). */
  visiting: Uint8Array;
  /** Scratch, per layer index: this frame's motion offset (read only; may be shared NO_MOTION). */
  motions: MotionOffset[];
}

const plans = new WeakMap<readonly Layer[], PosePlan>();

/** The plan for the rig's layers, built on first use; its scratch is cleared for a new call. */
export function posePlan(rig: Pick<Rig, "layers">): PosePlan {
  const { layers } = rig;
  let plan = plans.get(layers);
  if (plan === undefined) {
    const { byName } = layerIndex(rig);
    const first = new Map<string, number>();
    layers.forEach((layer, i) => {
      if (!first.has(layer.name)) first.set(layer.name, i);
    });
    const slot = Int32Array.from(layers, (layer) => first.get(layer.name) ?? -1);
    const parent = Int32Array.from(layers, (layer) => (layer.follow === undefined ? -1 : (first.get(layer.follow) ?? -1)));
    const order = layers
      .map((layer, index) => ({ layer, index, eye: eyeOf(layer, byName) }))
      .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index);
    const n = layers.length;
    plan = { slot, parent, order, worlds: new Array<World | undefined>(n), carries: new Array<Sim | undefined>(n), visiting: new Uint8Array(n), motions: [] };
    plans.set(layers, plan);
  }
  plan.worlds.fill(undefined);
  plan.carries.fill(undefined);
  plan.visiting.fill(0);
  return plan;
}

/**
 * Per layer index into `plan.motions`, its motion offset this frame (`actMotionAt`). A layer with
 * no motion of its own and no act playing on it gets the shared NO_MOTION: the same values
 * `actMotionAt` returns for it, without a fresh object (the offsets are only read).
 */
export function motionsOf(rig: Pick<Rig, "layers" | "height">, drive: Pick<Drive, "t" | "still" | "act">, plan: PosePlan): void {
  const still = drive.still === true;
  const { motions } = plan;
  motions.length = rig.layers.length;
  rig.layers.forEach((layer, i) => {
    motions[i] = layer.motion === undefined && drive.act?.layer !== layer.name ? NO_MOTION : actMotionAt(layer, drive.t, still, drive.act, rig.height);
  });
}

/**
 * Per slot into `plan.carries`, the float it carries: its parent's carried float, then its own
 * float (a turn about its anchor as posed by its gesture transform under the parent's carry, and a
 * move). It is composed after the gesture transform and before the layer's own parallax and jaw
 * drop (a turn about the anchor commutes with a move, so the layer's own float is as if applied
 * last), so a follower turns rigidly with its parent and its parallax stays a pure shift. Needs
 * `plan.worlds` and `plan.motions` filled.
 */
export function carriesOf(rig: Pick<Rig, "layers">, plan: PosePlan): void {
  const { slot, parent: parents, worlds, carries, visiting, motions } = plan;
  const resolve = (s: number): Sim => {
    const known = carries[s];
    const layer = rig.layers[s];
    if (known !== undefined) return known;
    if (layer === undefined) return IDENTITY;
    visiting[s] = 1;
    const p = parents[s] ?? -1;
    const inherited = p < 0 || visiting[p] === 1 ? IDENTITY : resolve(p);
    const motion = motions[s] ?? NO_MOTION;
    let carry = inherited;
    if (motion.rotation !== 0 || motion.dx !== 0 || motion.dy !== 0) {
      const posed = compose(inherited, worlds[s]?.sim ?? IDENTITY);
      const q = apply(posed, layer.anchor[0], layer.anchor[1]);
      carry = compose(turnAbout(q[0], q[1], motion.rotation, motion.dx, motion.dy), inherited);
    }
    visiting[s] = 0;
    carries[s] = carry;
    return carry;
  };
  for (let i = 0; i < slot.length; i += 1) resolve(slot[i] ?? i);
}
