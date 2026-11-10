// The stage's live light (costume requirement 8.1-8.3): one requestAnimationFrame loop that writes
// CSS variables through refs, so no React render runs per frame.
// - --back on the tunnel and the bloom: the backlight, eased toward his real speech level (the same
//   jawOpen meter that moves the jaw and lights VOICE) while he speaks; out on the dead line.
// - --heat on the plate image (once a second at most) and --flame/--glow/--refl on each candle: candleLevels from the smoothed
//   chat velocity (sampled once a second) and the chatters' recent posts (flares).
// - data-haunt on the stage: "off" when the theme's haunt tokens are zero (the baseline theme,
//   the haunt toggle off); the candles then stand still at their resting light.
// Reduced motion: the backlight holds a fixed level while he speaks and the candles update once a
// second, so nothing pulses frame to frame.
// Paint cost (perfection-pass task 11): --back changes every frame he speaks, so it is written on
// the layers that read it (`[data-back]` under the stage: the tunnel and the bloom), never on the
// stage, whose every descendant would otherwise restyle each frame. --heat likewise goes on its one
// reader (`[data-heat]`, the plate image; task 14), not the stage. Every variable is written only
// when its value changes. The loop stops while the document is hidden and picks up where it was
// (the backlight eases from its last level; the velocity samples at once).
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

/** Sets a custom property only when its text changes (an unchanged write still restyles). */
function write(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** The elements under the stage marked `attr` (Catacomb.tsx: `data-back`, `data-heat`), cached while they stay. */
function readers(root: HTMLElement, attr: string, known: HTMLElement[]): HTMLElement[] {
  if (known.length > 0 && known.every((el) => el.isConnected && root.contains(el))) return known;
  return [...root.querySelectorAll<HTMLElement>(`[${attr}]`)];
}

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
    let backs: HTMLElement[] = [];
    let heats: HTMLElement[] = [];

    const tick = (t: number) => {
      raf = 0;
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
        backs = readers(root, "data-back", backs);
        for (const el of backs) write(el, "--back", fixed(back));
        heats = readers(root, "data-heat", heats);
        const h = fixed(lit ? heatOf(rate) : 0);
        for (const el of heats) write(el, "--heat", h);
      }
      if (sample || !reduced) {
        const posts: Post[] = lit ? chatters.slice(-FLARE_LOOKBACK).map((m) => ({ user: m.user, ts: m.ts })) : [];
        const levels = candleLevels(lit ? rate : 0, o.now(), posts);
        const els = o.candles.current ?? [];
        for (let i = 0; i < CANDLE_COUNT; i += 1) {
          const el = els[i];
          const level = levels[i];
          if (el === null || el === undefined || level === undefined) continue;
          write(el, "--flame", fixed(level.flame));
          write(el, "--glow", fixed(level.glow));
          write(el, "--refl", fixed(level.reflection));
        }
      }
      if (!document.hidden) raf = window.requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!document.hidden && raf === 0) raf = window.requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.cancelAnimationFrame(raf);
    };
  }, [haunts]);

  return heat;
}
