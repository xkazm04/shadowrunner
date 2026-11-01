// The stage's live light (costume requirement 8.1-8.3): one requestAnimationFrame loop that writes
// CSS variables through refs, so no React render runs per frame.
// - --back on the stage: the tunnel backlight, eased toward his real speech level (the same
//   jawOpen meter that moves the jaw and lights VOICE) while he speaks; out on the dead line.
// - --heat on the stage and --flame/--glow/--refl on each candle: candleLevels from the smoothed
//   chat velocity (sampled once a second) and the chatters' recent posts (flares).
// - data-haunt on the stage: "off" when the theme's haunt tokens are zero (the baseline theme,
//   the haunt toggle off); the candles then stand still at their resting light.
// Reduced motion: the backlight holds a fixed level while he speaks and the candles update once a
// second, so nothing pulses frame to frame.
import type { ChatMsg } from "@sr/engine";
import { useEffect, useRef, useState, type RefObject } from "react";
import { CANDLE_COUNT, candleLevels, chatVelocity, heatOf, smooth, VELOCITY_SAMPLE_MS, type Post } from "./candles";

/** Posts the flare check looks back over (the newest ones). */
const FLARE_LOOKBACK = 16;

export interface StageLightsOptions {
  root: RefObject<HTMLElement | null>;
  candles: RefObject<(HTMLElement | null)[]>;
  chat: readonly ChatMsg[];
  /** The character's own name: his replies are not chatter and own no candle. */
  self: string;
  /** Now on the show clock (the chat stamps' clock). */
  now(): number;
  /** The speech level, 0..1, at a performance.now() time. */
  jawOpen(nowMs: number): number;
  speaking: boolean;
  dead: boolean;
}

export interface ChatHeat {
  /** Messages in the last 30 s. */
  velocity: number;
  /** Corridor heat, 0..1. */
  heat: number;
}

/** Whether the active theme haunts at all: its --sr-haunt-flicker is above zero (baseline: 0). */
export function themeHaunts(): boolean {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sr-haunt-flicker"));
  return Number.isFinite(value) && value > 0;
}

function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced";
}

const fixed = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function useStageLights(opts: StageLightsOptions, haunts: () => boolean = themeHaunts): ChatHeat {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const [heat, setHeat] = useState<ChatHeat>({ velocity: 0, heat: 0 });

  useEffect(() => {
    let raf = 0;
    let lastSample = -Infinity;
    let rate = 0;
    let haunt = true;
    let reduced = false;
    let back = 0;
    let shownHeat = -1;

    const tick = (t: number) => {
      const o = latest.current;
      const root = o.root.current;
      const sample = t - lastSample >= VELOCITY_SAMPLE_MS;
      const chatters = o.chat.filter((m) => m.user !== o.self);
      if (sample) {
        lastSample = t;
        haunt = haunts();
        reduced = reducedMotion();
        const velocity = chatVelocity(chatters, o.now());
        rate = smooth(rate, velocity);
        const h = Math.round(heatOf(rate) * 100) / 100;
        setHeat((prev) => (prev.velocity === velocity && prev.heat === h ? prev : { velocity, heat: h }));
        if (root !== null) root.dataset.haunt = haunt ? "on" : "off";
      }
      const lit = haunt && !o.dead;
      if (root !== null) {
        const target = o.dead || !o.speaking ? 0 : reduced ? 0.6 : Math.min(1, 0.35 + o.jawOpen(t) * 0.9);
        back = reduced ? target : back + (target - back) * 0.06;
        root.style.setProperty("--back", fixed(back));
        const h = lit ? heatOf(rate) : 0;
        if (h !== shownHeat) {
          shownHeat = h;
          root.style.setProperty("--heat", fixed(h));
        }
      }
      if (sample || !reduced) {
        const posts: Post[] = lit ? chatters.slice(-FLARE_LOOKBACK).map((m) => ({ user: m.user, ts: m.ts })) : [];
        const levels = candleLevels(lit ? rate : 0, o.now(), posts);
        const els = o.candles.current ?? [];
        for (let i = 0; i < CANDLE_COUNT; i += 1) {
          const el = els[i];
          const level = levels[i];
          if (el === null || el === undefined || level === undefined) continue;
          el.style.setProperty("--flame", fixed(level.flame));
          el.style.setProperty("--glow", fixed(level.glow));
          el.style.setProperty("--refl", fixed(level.reflection));
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [haunts]);

  return heat;
}
