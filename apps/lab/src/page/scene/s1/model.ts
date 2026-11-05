// S1's scene state, pure and clocked by the caller (the audio clock, ms). `apply` takes scene ops,
// `utter` takes spoken lines (for captions), and `sample(nowMs)` returns the frame both the live
// DOM view and the recorded painters draw, so what is seen live is what is recorded.
//
// Reduced-motion twin: every eased change becomes a cut (duration 0), the light does not flicker
// or follow speech, flames do not sway, a candle burst does not spike, a shout does not shake.
import type { SceneArgs, TimelineEvent } from "../../../contract.js";
import type { Utterance } from "../../types.js";

export type LightCue = Extract<SceneArgs, { op: "light" }>["cue"];
export type CaptionStyle = Extract<SceneArgs, { op: "caption" }>["style"];

/** The backlight: brightness, warm (ember) vs cold (phosphor) mix, darkness over the stage, flicker. */
export interface Look {
  level: number;
  warmth: number;
  dark: number;
  flicker: number;
}

export const BASE_LOOK: Look = { level: 0.45, warmth: 1, dark: 0, flicker: 0 };
export const LOOKS: Readonly<Record<LightCue, Look>> = {
  warm: { level: 0.85, warmth: 1, dark: 0, flicker: 0 },
  cold: { level: 0.7, warmth: 0, dark: 0.12, flicker: 0 },
  dim: { level: 0.18, warmth: 0.8, dark: 0.5, flicker: 0 },
  flicker: { level: 0.6, warmth: 0.9, dark: 0.1, flicker: 1 },
  blackout: { level: 0.03, warmth: 0.5, dark: 0.86, flicker: 0 },
};

/** Candle flame size per action (0 = unlit, the state before any candles op). */
export const FLAME: Readonly<Record<Extract<SceneArgs, { op: "candles" }>["action"], number>> = { burst: 1.25, dim: 0.4, steady: 1 };
export const CANDLES = 6;

export const MS = { light: 900, blackout: 250, flame: 600, burst: 700, card: 350, poll: 350, caption: 160, captionOut: 300 } as const;
/** A caption stays this long after its line's audio ends; a closed poll shows "closed" this long. */
export const CAPTION_HOLD_MS = 700;
export const POLL_CLOSED_MS = 1500;

export interface SceneFrame {
  light: Look;
  candles: { flames: readonly number[]; glow: number };
  card?: { title: string; body?: string; alpha: number; rise: number };
  caption?: { text: string; style: CaptionStyle; alpha: number; shake: number };
  poll?: { question: string; options: readonly string[]; alpha: number; closed: boolean };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const mix = (a: number, b: number, p: number): number => a + (b - a) * p;
/** Deterministic 0..1 noise per 60 ms step (the flicker's dropouts). */
const noise = (t: number): number => {
  const x = Math.sin(Math.floor(t / 60) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

type Line = Utterance & { style: CaptionStyle };

/** Ramps a value from `from` to `to`, starting at `at`, over `ms` (0 = a cut). */
interface Ramp {
  from: number;
  to: number;
  at: number;
  ms: number;
}
const rampAt = (r: Ramp, now: number): number => (r.ms <= 0 || now >= r.at + r.ms ? r.to : now <= r.at ? r.from : mix(r.from, r.to, ease((now - r.at) / r.ms)));

export class SceneModel {
  readonly #reduced: boolean;
  #lightFrom: Look = BASE_LOOK;
  #lightTo: Look = BASE_LOOK;
  #lightAt = 0;
  #lightMs = 0;
  #flame: Ramp = { from: 0, to: 0, at: 0, ms: 0 };
  #burstAt: number | undefined;
  #card: { id: string; title: string; body?: string; shownAt: number; hiddenAt?: number } | undefined;
  #poll: { question: string; options: string[]; openedAt: number; closedAt?: number } | undefined;
  #style: CaptionStyle = "plain";
  #lines: Line[] = [];
  /** Ops applied so far, by op (diagnostics and tests). */
  readonly applied: Record<SceneArgs["op"], number> = { light: 0, candles: 0, card: 0, caption: 0, poll: 0 };

  constructor(reducedMotion: boolean) {
    this.#reduced = reducedMotion;
  }

  #ms(ms: number): number {
    return this.#reduced ? 0 : ms;
  }

  apply(event: SceneArgs | Extract<TimelineEvent, { kind: "scene" }>, now: number): void {
    this.applied[event.op] += 1;
    switch (event.op) {
      case "light":
        this.#lightFrom = this.#look(now);
        this.#lightTo = LOOKS[event.cue];
        this.#lightAt = now;
        this.#lightMs = this.#ms(event.cue === "blackout" ? MS.blackout : MS.light);
        break;
      case "candles":
        this.#flame = { from: rampAt(this.#flame, now), to: FLAME[event.action], at: now, ms: this.#ms(MS.flame) };
        if (event.action === "burst") this.#burstAt = now;
        break;
      case "card":
        if (event.action === "show") {
          const body = event.body;
          this.#card = { id: event.id, title: event.title ?? event.id, ...(body === undefined ? {} : { body }), shownAt: now };
        } else if (this.#card?.id === event.id && this.#card.hiddenAt === undefined) {
          this.#card.hiddenAt = now;
        }
        break;
      case "caption":
        this.#style = event.style;
        break;
      case "poll":
        if (event.action === "open") {
          this.#poll = { question: event.question ?? "Chat decides", options: event.options ?? [], openedAt: now };
        } else if (this.#poll !== undefined && this.#poll.closedAt === undefined) {
          this.#poll.closedAt = now;
        }
        break;
    }
  }

  /** A spoken line, captioned in the style in force when its audio was scheduled. */
  utter(line: Utterance): void {
    this.#lines = [...this.#lines, { ...line, style: this.#style }].slice(-4);
  }

  /** The light without flicker or speech (the base a new cue eases from). */
  #look(now: number): Look {
    const p = this.#lightMs <= 0 || now >= this.#lightAt + this.#lightMs ? 1 : ease(clamp01((now - this.#lightAt) / this.#lightMs));
    const a = this.#lightFrom;
    const b = this.#lightTo;
    return { level: mix(a.level, b.level, p), warmth: mix(a.warmth, b.warmth, p), dark: mix(a.dark, b.dark, p), flicker: mix(a.flicker, b.flicker, p) };
  }

  /** `speech` is the smoothed speech level 0..1 (ignored under reduced motion). */
  sample(now: number, speech = 0): SceneFrame {
    const look = this.#look(now);
    const moving = !this.#reduced;
    const drop = moving && look.flicker > 0 ? look.flicker * 0.75 * noise(now) ** 2 : 0;
    const level = clamp01(look.level * (1 - drop) + (moving ? 0.2 * speech * (1 - look.dark) : 0));
    const frame: SceneFrame = { light: { ...look, level }, candles: this.#candles(now) };
    const card = this.#cardFrame(now);
    if (card !== undefined) frame.card = card;
    const caption = this.#captionFrame(now);
    if (caption !== undefined) frame.caption = caption;
    const poll = this.#pollFrame(now);
    if (poll !== undefined) frame.poll = poll;
    return frame;
  }

  #candles(now: number): SceneFrame["candles"] {
    let size = rampAt(this.#flame, now);
    if (!this.#reduced && this.#burstAt !== undefined && now >= this.#burstAt) size += 1.1 * Math.exp(-(now - this.#burstAt) / MS.burst);
    const flames = Array.from({ length: CANDLES }, (_, i) =>
      this.#reduced || size === 0 ? size : size * (1 + 0.12 * Math.sin(now / 90 + i * 1.7) + 0.06 * Math.sin(now / 37 + i * 2.3)),
    );
    return { flames, glow: size };
  }

  #fade(now: number, inAt: number, inMs: number, outAt: number | undefined, outMs: number): number {
    const fadeIn = this.#reduced ? (now >= inAt ? 1 : 0) : clamp01((now - inAt) / inMs);
    if (outAt === undefined || now < outAt) return fadeIn;
    return this.#reduced ? 0 : fadeIn * (1 - clamp01((now - outAt) / outMs));
  }

  #cardFrame(now: number): SceneFrame["card"] {
    const c = this.#card;
    if (c === undefined) return undefined;
    const alpha = this.#fade(now, c.shownAt, MS.card, c.hiddenAt, MS.card);
    if (alpha <= 0 && c.hiddenAt !== undefined) {
      this.#card = undefined;
      return undefined;
    }
    return { title: c.title, ...(c.body === undefined ? {} : { body: c.body }), alpha, rise: this.#reduced ? 0 : (1 - ease(alpha)) * 24 };
  }

  #captionFrame(now: number): SceneFrame["caption"] {
    let line: Line | undefined;
    for (const l of this.#lines) if (l.atMs <= now) line = l;
    if (line === undefined) return undefined;
    const alpha = this.#fade(now, line.atMs, MS.caption, line.atMs + line.durationMs + CAPTION_HOLD_MS, MS.captionOut);
    if (alpha <= 0) return undefined;
    const since = now - line.atMs;
    const shake = !this.#reduced && line.style === "shout" && since < 500 ? Math.sin(since / 25) * 6 * (1 - since / 500) : 0;
    return { text: line.text, style: line.style, alpha, shake };
  }

  #pollFrame(now: number): SceneFrame["poll"] {
    const p = this.#poll;
    if (p === undefined) return undefined;
    const outAt = p.closedAt === undefined ? undefined : p.closedAt + POLL_CLOSED_MS;
    const alpha = this.#fade(now, p.openedAt, MS.poll, outAt, MS.poll);
    if (alpha <= 0 && outAt !== undefined && now >= outAt) {
      this.#poll = undefined;
      return undefined;
    }
    return { question: p.question, options: p.options, alpha, closed: p.closedAt !== undefined && now >= p.closedAt };
  }
}
