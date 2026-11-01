// costume 5.1: the wall of sets is tonight's schedule. Properties over any cast: one big set on
// now and first, every other member once in cast order an hour apart, then the vacant hour and the
// sealed channel; the small sets power on in schedule order and the big set after all of them,
// and the ON AIR sign lights after the last tube.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accentOf, bootTimeline, hourAfter, wallSets, type WallMember } from "./ListingsWall";

const CHANNELS = { live: 2, later: 3, sealed: 9 };

const member = fc.record({ id: fc.string({ minLength: 1, maxLength: 8 }), slug: fc.string({ maxLength: 8 }), name: fc.string({ maxLength: 12 }) });
const cast = fc.uniqueArray(member, { selector: (m) => m.id, maxLength: 14 });
const withHouse = fc.tuple(cast, fc.boolean()).map(([list, house]) =>
  house ? [{ id: "malakor", slug: "malakor", name: "Arch-Lich Malakor" }, ...list.filter((m) => m.id !== "malakor")] : list,
);

const hourOf = (h: string): number => Number(h.slice(0, 2));

describe("wallSets", () => {
  it("lists the house first, the rest once in order an hour apart, then vacant and sealed", () => {
    fc.assert(
      fc.property(withHouse, (list: WallMember[]) => {
        const sets = wallSets(list, "malakor", CHANNELS);
        const hasHouse = list.some((m) => m.id === "malakor");
        const later = list.filter((m) => m.id !== "malakor");
        expect(sets.length).toBe(later.length + 2 + (hasHouse ? 1 : 0));
        if (hasHouse) expect(sets[0]?.kind).toBe("live");
        expect(sets.filter((s) => s.kind === "live").length).toBe(hasHouse ? 1 : 0);
        expect(sets.filter((s) => s.kind === "cast").map((s) => s.member?.id)).toEqual(later.map((m) => m.id));
        expect(sets.at(-1)?.kind).toBe("sealed");
        expect(sets.at(-2)?.kind).toBe("vacant");
        const hours = sets.filter((s) => s.kind !== "sealed").map((s) => hourOf(s.hour));
        hours.forEach((h, i) => {
          if (i > 0) expect((h - (hours[i - 1] ?? 0) + 24) % 24).toBe(1);
        });
        expect(new Set(sets.map((s) => s.key)).size).toBe(sets.length);
      }),
    );
  });

  it("powers the small sets on in schedule order and the big set last, then lights ON AIR", () => {
    fc.assert(
      fc.property(withHouse, (list: WallMember[]) => {
        const sets = wallSets(list, "malakor", CHANNELS);
        const smalls = sets.filter((s) => s.kind !== "live");
        smalls.forEach((s, i) => {
          if (i > 0) expect(s.bootDelay).toBeGreaterThan(smalls[i - 1]?.bootDelay ?? 0);
        });
        const big = sets.find((s) => s.kind === "live");
        if (big !== undefined) for (const s of smalls) expect(big.bootDelay).toBeGreaterThan(s.bootDelay);
        const { litMs, idleMs } = bootTimeline(sets);
        for (const s of sets) expect(litMs).toBeGreaterThan(s.bootDelay * 1000);
        expect(idleMs).toBeGreaterThan(litMs);
      }),
    );
  });

  it("keeps the fallback house on the big set when the cast does not carry him", () => {
    fc.assert(
      fc.property(cast, (list) => {
        const house = { id: "malakor", slug: "malakor", name: "Arch-Lich Malakor" };
        const sets = wallSets(list.filter((m) => m.id !== "malakor"), "malakor", CHANNELS, house);
        expect(sets[0]?.member).toBe(house);
        expect(sets[0]?.plate).toBe("03:00 · ON AIR NOW · CH 2");
      }),
    );
  });

  it("labels the hours the listings used and gives unknown characters the theme accent", () => {
    expect(hourAfter(0)).toBe("03:00");
    expect(hourAfter(6)).toBe("09:00");
    expect(hourAfter(21)).toBe("00:00");
    expect(accentOf("moth-widow")).toBe("wall-cast-moth");
    expect(accentOf("toString")).toBe("accent");
    expect(accentOf("a-ghost")).toBe("accent");
  });
});
