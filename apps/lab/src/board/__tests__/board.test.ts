import { describe, expect, it } from "vitest";
import type { RunConfig } from "../../contract.js";
import { axisOf, parseBoardArgs, pickMoment, unit } from "../board.js";

const base: RunConfig = { control: "C0", lip: "L0", scene: "S0", output: "O0", scenario: "haunt-01", seed: 1 };

describe("board args", () => {
  it("reads pairs, clip length and seed", () => {
    expect(parseBoardArgs(["--pairs", "a:b,c:d", "--clip", "12", "--seed", "4"])).toEqual({ pairs: [["a", "b"], ["c", "d"]], clipS: 12, seed: 4 });
    expect(parseBoardArgs(["--pairs", "a:b"]).clipS).toBe(20);
  });

  it("refuses bad pairs and clips over 20 s", () => {
    expect(() => parseBoardArgs([])).toThrow(/--pairs/);
    expect(() => parseBoardArgs(["--pairs", "a"])).toThrow(/not a pair/);
    expect(() => parseBoardArgs(["--pairs", "a:a"])).toThrow(/itself/);
    expect(() => parseBoardArgs(["--pairs", "a:b", "--clip", "30"])).toThrow(/--clip/);
  });
});

describe("axis", () => {
  it("names the arms that differ", () => {
    expect(axisOf(base, { ...base, lip: "L1" })).toBe("lip");
    expect(axisOf(base, { ...base, control: "C1", scene: "S1" })).toBe("control+scene");
    expect(axisOf(base, base)).toBe("same");
    expect(axisOf(base, { ...base, external: "overlord" })).toBe("external");
  });
});

describe("moment", () => {
  const a = { turns: new Map([["c1", 2], ["c2", 16], ["c3", 31]]), durationS: 50, firstLine: 5 };
  const b = { turns: new Map([["c1", 2.1], ["c2", 16.2], ["c3", 31.1]]), durationS: 40, firstLine: 6 };

  it("cuts both runs at the same chat message with a full clip after it", () => {
    const m = pickMoment(a, b, 20, "seed");
    expect(m.by).toBe("chat");
    expect(["c1", "c2"]).toContain(m.chatId);
    expect(m.startB).toBe(b.turns.get(m.chatId ?? ""));
    expect(pickMoment(a, b, 20, "seed")).toEqual(m);
  });

  it("falls back to each run's first line when no chat is shared", () => {
    expect(pickMoment(a, { ...b, turns: new Map() }, 20, "s")).toEqual({ by: "first-line", startA: 5, startB: 6 });
    expect(() => pickMoment(a, { turns: new Map(), durationS: 10 }, 20, "s")).toThrow(/no chat message/);
  });

  it("unit is deterministic and in [0, 1)", () => {
    expect(unit("x")).toBe(unit("x"));
    expect(unit("x")).toBeGreaterThanOrEqual(0);
    expect(unit("x")).toBeLessThan(1);
  });
});
