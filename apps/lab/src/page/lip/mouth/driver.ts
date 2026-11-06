// The lip driver body L1 and L2 share: visemes into the scheduler (track.ts), and the shape mix
// handed to the player (`setMouthShapes`): @sr/avatar draws the mouth itself (the rig owns the
// mouth: on Rig.mouth, in the head's frame, with the character's emotion, which main.ts already
// hands the player with `setEmotion`) and opens the jaw to match. The stage audio is NOT attached
// to the player: the mouth is shaped here. An utterance that arrives without visemes falls back to
// the speech level (a mid-open mouth as loud as the line), so a missing visemeSource never freezes
// the mouth.
//
// main.ts calls `frame(nowMs)` BEFORE it renders the player, so the mix set here is drawn in the
// same frame (and a painter pairs it with the player's alpha from that frame); the jaw is read
// JAW_LEAD_MS ahead because it eases toward its target.
//
// Shapes reach the player when it moves this rig's mouth itself: mouthMode "drawn" (the procedural
// mouth) or "warp" (the art's own lips bent by the shader, the default for a measured mouth). A rig
// without `mouth`, or marked render "still", moves only the jaw, through `setLevel`.
//
// Reduced motion (the twin, used when the viewer asks and the run does not force motion): no
// per-viseme articulation; while a line plays the mouth eases (REDUCED_EASE_MS) to one soft, half
// open speaking shape and back to rest after it; the player switches an emotion at once.
import { blendParams, jawLevel, levelWeights, restWeights, type ShapeWeights } from "@sr/avatar/core";
import type { LipArmId, LipDriver } from "../../../contract.js";
import type { LipContext } from "../../types.js";
import { mouthAnchor, type MouthAnchor } from "./anchor.js";
import { createVisemeTrack, type VisemeTrack } from "./track.js";

/** The jaw eases toward its target (the driver's attack); asking slightly early keeps it on time. */
export const JAW_LEAD_MS = 30;
export const REDUCED_EASE_MS = 150;

export interface MouthFrame {
  nowMs: number;
  /** The mouth in this frame (Rig.mouth when the rig has one), in the head's frame. */
  anchor: MouthAnchor;
  /** The mix the player drew this frame. */
  weights: ShapeWeights;
  /** 0..1: how much the drawn mouth replaced the art's own this frame (the player's alpha; 0 = none). */
  alpha: number;
}

/** Paints over the player's mouth in the recorded composite (L2's forge art). */
export type MouthPainter = (g: CanvasRenderingContext2D, frame: MouthFrame) => void;

export interface MouthDriverHandle extends LipDriver {
  /** The scheduler (tests). */
  readonly track: VisemeTrack;
}

export interface MouthDriverOptions {
  /** The mix the jaw opens for (default: the shown mix). L2 counts shapes its art draws as rest. */
  jawWeights?: (weights: ShapeWeights) => ShapeWeights;
  /** The part of the mix the player draws (default all); L2 draws the rest itself. */
  drawn?: (weights: ShapeWeights) => Partial<ShapeWeights>;
  /** Paints over the player's mouth in the recorded composite, every frame (alpha 0: nothing drawn). */
  paint?: MouthPainter;
}

export function createMouthDriver(id: LipArmId, ctx: LipContext, options: MouthDriverOptions = {}): MouthDriverHandle {
  const { player, audio, reducedMotion } = ctx;
  player.attachAudio(undefined);
  const track = createVisemeTrack();
  // A hand-made player without mouthMode (older fakes) is taken at its rig's word: a mouth draws.
  const mode = player.mouthMode?.() ?? (ctx.mouth === undefined ? undefined : "drawn");
  const drawsMouth = (mode === "drawn" || mode === "warp") && player.setMouthShapes !== undefined;
  if (!drawsMouth) {
    console.warn(
      mode === "still"
        ? `Lip arm ${id}: this rig keeps its art's mouth (Rig.mouth.render "still"), so only the jaw moves.`
        : `Lip arm ${id}: this rig has no measured mouth (Rig.mouth), so only the jaw moves (back-fill it: scripts/cast/mouth-backfill.mjs).`,
    );
  }
  // The mix the player draws this frame.
  let shown = restWeights();
  let soft = 0;
  let lastMs: number | undefined;

  const mixAt = (nowMs: number): ShapeWeights => {
    const speech = track.speech(nowMs);
    if (speech === "unmarked") return levelWeights(audio.level());
    return track.weights(nowMs);
  };

  const reducedMix = (nowMs: number, dt: number): ShapeWeights => {
    const target = track.speech(nowMs) === "silent" ? 0 : 1;
    soft += (target - soft) * (1 - Math.exp(-dt / REDUCED_EASE_MS));
    const out = restWeights();
    out.openMid = 0.5 * soft;
    out.rest = 1 - out.openMid;
    return out;
  };

  if (options.paint !== undefined) {
    const paint = options.paint;
    ctx.addPainter((g, nowMs) => {
      if (!drawsMouth) return;
      const anchor = mouthAnchor(player.layerFrames?.() ?? [], ctx.mouth);
      if (anchor !== undefined) paint(g, { nowMs, anchor, weights: shown, alpha: player.mouth?.()?.alpha ?? 0 });
    });
  }

  return {
    id,
    track,
    onAudio(event, audioStartMs) {
      track.startUtterance(event.id, audioStartMs, event.durationMs);
    },
    onViseme(event) {
      track.addViseme(event.id, event.v, event.startMs, event.endMs);
    },
    frame(nowMs) {
      const dt = lastMs === undefined ? 0 : Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      const weights = reducedMotion ? reducedMix(nowMs, dt) : mixAt(nowMs);
      const jawMix = reducedMotion ? weights : mixAt(nowMs + JAW_LEAD_MS);
      const jaw = options.jawWeights?.(jawMix) ?? jawMix;
      if (drawsMouth) {
        const drawn = options.drawn?.(weights);
        player.setMouthShapes?.(weights, { jaw, ...(drawn === undefined ? {} : { drawn }) });
        shown = weights;
      } else {
        player.setLevel(jawLevel(blendParams(jaw).jaw));
      }
    },
    dispose() {
      player.setMouthShapes?.(undefined);
      player.setLevel(undefined);
    },
  };
}
