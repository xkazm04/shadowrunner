// The wall candles (costume requirement 8.2, design.md "Air"): chat velocity, not fog, lights the
// catacomb. Eight candles are painted into the plate; every chatter owns one by name. The busier
// chat runs, the taller the flames, the wider their glow and the longer their reflection on the
// wet floor; a chatter's own candle flares when they post and settles back over FLARE_MS.
// Pure: AirPage samples the velocity once a second and writes the levels into CSS variables on
// each candle from a requestAnimationFrame loop (no React render per frame).
import type { ChatMsg } from "@sr/engine";

/** The candles painted in the catacomb plate. */
export const CANDLE_COUNT = 8;
/** Chat velocity counts the messages of this window. */
export const VELOCITY_WINDOW_MS = 30_000;
/** One EMA step per sample. */
export const VELOCITY_EMA_ALPHA = 0.2;
/** Messages per 30 s at which the corridor burns at full heat. */
export const FULL_RATE = 12;
/** How often the stage samples the velocity. */
export const VELOCITY_SAMPLE_MS = 1_000;
/** A flare's life: full at the post, gone after this long. */
export const FLARE_MS = 1_400;

/** A post as the candles see it: who, and when on the show clock. */
export interface Post {
  user: string;
  ts: number;
}

/** One candle's light, each in [0, 1]. */
export interface CandleLevel {
  /** Flame height. */
  flame: number;
  /** Halo on the wall. */
  glow: number;
  /** Streak on the wet floor. */
  reflection: number;
}

/** Messages stamped within the last window before `now` (show clock, the stamps' clock). */
export function chatVelocity(chat: readonly Pick<ChatMsg, "ts">[], now: number): number {
  let n = 0;
  for (const msg of chat) if (msg.ts > now - VELOCITY_WINDOW_MS && msg.ts <= now) n += 1;
  return n;
}

/** One EMA step; a non-finite sample leaves the average as it was. */
export function smooth(prev: number, sample: number, alpha = VELOCITY_EMA_ALPHA): number {
  if (!Number.isFinite(sample)) return prev;
  return prev + alpha * (sample - prev);
}

/** The candle a chatter owns: a stable hash of the name, mod the candle count. */
export function candleOf(user: string, count = CANDLE_COUNT): number {
  let h = 0;
  for (let i = 0; i < user.length; i += 1) h = (h * 31 + user.charCodeAt(i)) >>> 0;
  return h % count;
}

/** Corridor heat for a smoothed velocity: 0 when idle (or nonsense), 1 at FULL_RATE and above. */
export function heatOf(rate: number): number {
  if (!(rate > 0)) return 0;
  return Math.min(1, rate / FULL_RATE);
}

const clamp01 = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0);

/**
 * Every candle's light at `now`: a base from the corridor heat (`rate`, smoothed messages per
 * 30 s), plus a flare on the candle of each chatter who posted within FLARE_MS before `now`.
 * Bounded to [0, 1]; non-decreasing in `rate`; posts from the future or with non-finite stamps
 * are ignored.
 */
export function candleLevels(rate: number, now: number, posts: readonly Post[]): CandleLevel[] {
  const heat = heatOf(rate);
  const flares = new Array<number>(CANDLE_COUNT).fill(0);
  if (Number.isFinite(now)) {
    for (const post of posts) {
      const age = now - post.ts;
      if (!(age >= 0 && age < FLARE_MS)) continue;
      const i = candleOf(post.user);
      flares[i] = Math.max(flares[i] ?? 0, 1 - age / FLARE_MS);
    }
  }
  return flares.map((flare) => ({
    flame: clamp01(0.3 + 0.55 * heat + 0.6 * flare),
    glow: clamp01(0.2 + 0.6 * heat + 0.8 * flare),
    reflection: clamp01(0.2 + 0.55 * heat + 0.4 * flare),
  }));
}
