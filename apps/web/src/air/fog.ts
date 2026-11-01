// Fog follows chat velocity (voice-and-air requirement 5.2, design.md): velocity = messages in the
// last 30 s, smoothed by an EMA (alpha 0.2), mapped min(1, v / 12) into --sr-haunt-fog on the
// stage root, clamped to [0, 1]. Pure; useFog in AirPage samples it once a second.
import type { ChatMsg } from "@sr/engine";

export const VELOCITY_WINDOW_MS = 30_000;
export const FOG_EMA_ALPHA = 0.2;
/** Messages per 30 s at which the fog is full. */
export const FOG_FULL_VELOCITY = 12;
/** How often the stage samples the velocity. */
export const FOG_SAMPLE_MS = 1_000;

/** Messages stamped within the last window before `now` (show clock, the stamps' clock). */
export function chatVelocity(chat: readonly ChatMsg[], now: number): number {
  let n = 0;
  for (const msg of chat) if (msg.ts > now - VELOCITY_WINDOW_MS && msg.ts <= now) n += 1;
  return n;
}

/** One EMA step; a non-finite sample leaves the average as it was. */
export function smooth(prev: number, sample: number, alpha = FOG_EMA_ALPHA): number {
  if (!Number.isFinite(sample)) return prev;
  return prev + alpha * (sample - prev);
}

/**
 * Fog density for a smoothed velocity, in [0, 1]. `haunt` is whether the theme haunts at all:
 * the baseline theme binds the haunt tokens to zero, and so does the stage (requirement 5.4).
 */
export function fogFor(velocity: number, haunt: boolean): number {
  if (!haunt || !(velocity > 0)) return 0;
  return Math.min(1, velocity / FOG_FULL_VELOCITY);
}
