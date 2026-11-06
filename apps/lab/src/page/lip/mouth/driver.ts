// The lip driver body L1 and L2 share: visemes into the scheduler (track.ts), the jaw opened with
// `setLevel` (the stage audio is NOT attached to the player: the mouth is shaped here), and one
// painter in the recorded composite that finds the mouth on the jaw each frame and hands the arm
// the shape mix to draw. An utterance that arrives without visemes falls back to the speech level
// (a mid-open mouth as loud as the line), so a missing visemeSource never freezes the mouth.
//
// Reduced motion (the twin, used when the viewer asks and the run does not force motion): no
// per-viseme articulation; while a line plays the mouth eases (REDUCED_EASE_MS) to one soft, half
// open speaking shape and back to rest after it; an emotion change switches at once.
//
// Emotion (emotion.ts): the drawn mouth carries the character's emotion, added to the viseme mix
// every frame. It sits on the rig's measured mouth (ctx.mouth) when the rig has one. At rest with
// a non-neutral emotion the drawn mouth shows (cover = max(talk cover, emotion strength)); at rest
// with neutral the art is untouched.
import { JAW_FLOOR } from "@sr/avatar/core";
import type { LipArmId, LipDriver } from "../../../contract.js";
import type { LipContext } from "../../types.js";
import { sampleSkin, type MouthColours } from "./colours.js";
import { mouthAnchor, type MouthAnchor } from "./anchor.js";
import { applyBias, createEmotionEase, NO_BIAS, type EmotionBias, type EmotionEase } from "./emotion.js";
import { blendParams, restWeights, type MouthParams, type ShapeWeights } from "./shapes.js";
import { createVisemeTrack, type VisemeTrack } from "./track.js";

/** The jaw eases toward its target (the driver's attack); asking slightly early keeps it on time. */
export const JAW_LEAD_MS = 30;
export const REDUCED_EASE_MS = 150;

export interface MouthFrame {
  nowMs: number;
  anchor: MouthAnchor;
  weights: ShapeWeights;
  /** The shown mix's params with the emotion added. */
  params: MouthParams;
  /** The emotion's bias this frame (an arm blending its own params adds it with applyBias). */
  bias: EmotionBias;
  colours: MouthColours;
  /** 0..1: how much the drawn mouth replaces the art's own (0 at neutral rest: the art untouched). */
  alpha: number;
}

export type MouthPainter = (g: CanvasRenderingContext2D, frame: MouthFrame) => void;

/** Level -> a mid-open mouth, for lines without visemes. */
export function levelWeights(level: number): ShapeWeights {
  const out = restWeights();
  const open = Math.min(1, Math.max(0, (level - JAW_FLOOR) * 2.5));
  out.openMid = open;
  out.rest = 1 - open;
  return out;
}

/** Player level for a jaw opening 0..1: the player maps level to jaw above its floor. */
export const jawLevel = (jaw: number): number => (jaw > 0.005 ? JAW_FLOOR + Math.min(1, jaw) * (1 - JAW_FLOOR) : 0);

/** How strongly the drawn mouth covers the art for a mix: full by the time rest is half gone. */
export const coverOf = (weights: ShapeWeights): number => Math.min(1, Math.max(0, (1 - weights.rest) * 2));

export interface MouthDriverHandle extends LipDriver {
  /** The scheduler (tests). */
  readonly track: VisemeTrack;
  /** The emotion easing (tests). */
  readonly emotion: EmotionEase;
}

export interface MouthDriverOptions {
  /** The mix the jaw opens for (default: the shown mix). L2 counts shapes its art draws as rest. */
  jawWeights?: (weights: ShapeWeights) => ShapeWeights;
}

export function createMouthDriver(id: LipArmId, ctx: LipContext, paint: MouthPainter, options: MouthDriverOptions = {}): MouthDriverHandle {
  const { player, audio, reducedMotion } = ctx;
  player.attachAudio(undefined);
  const track = createVisemeTrack();
  const emotion = createEmotionEase(reducedMotion);
  let bias: EmotionBias = NO_BIAS;
  let strength = 0;
  let weights = restWeights();
  let soft = 0;
  let lastMs: number | undefined;
  let colours: MouthColours | undefined;
  let resample = true;
  let warned = false;

  const mixAt = (nowMs: number): ShapeWeights => {
    const speech = track.speech(nowMs);
    if (speech === "unmarked") return levelWeights(audio.level());
    return track.weights(nowMs);
  };

  const reducedMix = (nowMs: number): ShapeWeights => {
    const dt = lastMs === undefined ? 0 : Math.max(0, nowMs - lastMs);
    const target = track.speech(nowMs) === "silent" ? 0 : 1;
    soft += (target - soft) * (1 - Math.exp(-dt / REDUCED_EASE_MS));
    const out = restWeights();
    out.openMid = 0.5 * soft;
    out.rest = 1 - out.openMid;
    return out;
  };

  ctx.addPainter((g, nowMs) => {
    const anchor = mouthAnchor(player.layerFrames?.() ?? [], ctx.mouth);
    if (anchor === undefined) {
      if (!warned) console.warn(`Lip arm ${id}: this rig has no jaw layer, so there is no mouth to draw.`);
      warned = true;
      return;
    }
    // The composite holds the back layers and the avatar only at this point: clean art to sample.
    // An expressive face may still paint its own mouth around the lips: keep the neutral sample.
    if (colours === undefined || (resample && !emotion.expressive && strength === 0)) {
      colours = sampleSkin(g, anchor) ?? colours;
      resample = colours === undefined;
    }
    if (colours === undefined) return;
    // `frame(nowMs)` ran just before the painters, on the same clock reading.
    const talk = reducedMotion ? Math.min(1, soft * 2) : coverOf(weights);
    const alpha = Math.max(talk, strength);
    paint(g, { nowMs, anchor, weights, params: applyBias(blendParams(weights), bias), bias, colours, alpha });
  });

  return {
    id,
    track,
    emotion,
    onAudio(event, audioStartMs) {
      track.startUtterance(event.id, audioStartMs, event.durationMs);
      resample = true;
    },
    onViseme(event) {
      track.addViseme(event.id, event.v, event.startMs, event.endMs);
    },
    onEmotion(value) {
      emotion.set(value, audio.nowMs());
    },
    frame(nowMs) {
      ({ bias, strength } = emotion.at(nowMs));
      weights = reducedMotion ? reducedMix(nowMs) : mixAt(nowMs);
      lastMs = nowMs;
      const jawMix = reducedMotion ? weights : mixAt(nowMs + JAW_LEAD_MS);
      const jaw = applyBias(blendParams(options.jawWeights?.(jawMix) ?? jawMix), bias).jaw;
      player.setLevel(jawLevel(jaw));
    },
    dispose() {
      player.setLevel(undefined);
    },
  };
}
