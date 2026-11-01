// The wall candles (costume requirement 8.2): chat velocity lights the catacomb, a post flares its
// chatter's candle. Property tests over candleLevels plus the velocity helpers it replaced fog with.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CANDLE_COUNT,
  candleLevels,
  candleOf,
  chatVelocity,
  FLARE_MS,
  FULL_RATE,
  heatOf,
  smooth,
  VELOCITY_WINDOW_MS,
  type CandleLevel,
  type Post,
} from "./candles";

const anyNumber = fc.oneof(fc.double(), fc.integer({ min: -1e6, max: 1e6 }), fc.constantFrom(Number.NaN, Infinity, -Infinity));
const post: fc.Arbitrary<Post> = fc.record({ user: fc.string({ maxLength: 12 }), ts: anyNumber });
const rate = fc.double({ min: -50, max: 200, noNaN: true });
const now = fc.integer({ min: 0, max: 1e7 });
const recentPosts = (at: number) => fc.array(fc.record({ user: fc.string({ maxLength: 12 }), ts: fc.integer({ min: at - 2 * FLARE_MS, max: at + 500 }) }), { maxLength: 20 });

const channels = (l: CandleLevel) => [l.flame, l.glow, l.reflection];

describe("candleLevels", () => {
  it("lights exactly eight candles, every channel bounded to [0, 1], whatever comes in", () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, fc.array(post, { maxLength: 30 }), (r, t, posts) => {
        const levels = candleLevels(r, t, posts);
        expect(levels).toHaveLength(CANDLE_COUNT);
        for (const v of levels.flatMap(channels)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("rises with chat velocity: a faster chat never dims a candle", () => {
    fc.assert(
      fc.property(rate, rate, now.chain((t) => fc.tuple(fc.constant(t), recentPosts(t))), (a, b, [t, posts]) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const slow = candleLevels(lo, t, posts).flatMap(channels);
        const fast = candleLevels(hi, t, posts).flatMap(channels);
        slow.forEach((v, i) => expect(fast[i]).toBeGreaterThanOrEqual(v));
      }),
    );
    // and it does rise: idle to full heat brightens every channel of every candle
    const idle = candleLevels(0, 0, []).flatMap(channels);
    candleLevels(FULL_RATE, 0, []).flatMap(channels).forEach((v, i) => expect(v).toBeGreaterThan(idle[i] ?? 1));
  });

  it("flares the poster's own candle, and only theirs, at any heat", () => {
    fc.assert(
      fc.property(rate, now, fc.string({ minLength: 1, maxLength: 16 }), fc.integer({ min: 0, max: FLARE_MS - 1 }), (r, t, user, age) => {
        const before = candleLevels(r, t, []);
        const after = candleLevels(r, t, [{ user, ts: t - age }]);
        const mine = candleOf(user);
        for (let i = 0; i < CANDLE_COUNT; i += 1) {
          const [b, a] = [before[i], after[i]];
          if (b === undefined || a === undefined) throw new Error("missing candle");
          if (i === mine) expect(a.glow).toBeGreaterThan(b.glow);
          else expect(a).toEqual(b);
        }
      }),
    );
  });

  it("lets a flare die down: gone after FLARE_MS, and never lit by a post from the future", () => {
    fc.assert(
      fc.property(rate, now, fc.string({ maxLength: 12 }), fc.integer({ min: 1, max: 1e6 }), (r, t, user, d) => {
        const rest = candleLevels(r, t, []);
        expect(candleLevels(r, t, [{ user, ts: t - FLARE_MS - d + 1 }])).toEqual(rest);
        expect(candleLevels(r, t, [{ user, ts: t + d }])).toEqual(rest);
      }),
    );
    const at = (age: number) => candleLevels(0, 10_000, [{ user: "GraveMoth", ts: 10_000 - age }])[candleOf("GraveMoth")]?.flame ?? 0;
    expect(at(0)).toBeGreaterThan(at(FLARE_MS / 2));
    expect(at(FLARE_MS / 2)).toBeGreaterThan(at(FLARE_MS - 1));
  });
});

describe("candleOf", () => {
  it("gives every chatter one stable candle", () => {
    fc.assert(
      fc.property(fc.string(), (user) => {
        const i = candleOf(user);
        expect(Number.isInteger(i) && i >= 0 && i < CANDLE_COUNT).toBe(true);
        expect(candleOf(user)).toBe(i);
      }),
    );
  });
});

describe("chat velocity", () => {
  const msg = (ts: number) => ({ ts });

  it("counts the messages of the last 30 s", () => {
    const chat = [0, 1_000, 20_000, 29_999, 31_000, 40_000].map(msg);
    expect(chatVelocity(chat, 40_000)).toBe(4); // 20 000, 29 999, 31 000, 40 000
    expect(chatVelocity(chat, 40_000 + VELOCITY_WINDOW_MS)).toBe(0);
  });

  it("smooths with alpha 0.2 and maps into heat in [0, 1]", () => {
    expect(smooth(0, 10)).toBeCloseTo(2);
    expect(smooth(5, Number.NaN)).toBe(5);
    fc.assert(
      fc.property(anyNumber, (v) => {
        const h = heatOf(v);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(1);
      }),
    );
    expect(heatOf(FULL_RATE / 2)).toBeCloseTo(0.5);
    expect(heatOf(FULL_RATE * 3)).toBe(1);
  });

  it("rises while chat is busy and settles back when it stops", () => {
    let v = 0;
    for (let s = 0; s < 30; s += 1) v = smooth(v, 12);
    expect(heatOf(v)).toBeGreaterThan(0.99);
    for (let s = 0; s < 30; s += 1) v = smooth(v, 0);
    expect(heatOf(v)).toBeLessThan(0.01);
  });
});
