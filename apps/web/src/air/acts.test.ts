// tiger L1: signature acts on air. Lot Ninety's recorded show fires his right glove's act on exactly
// the three beats that say "Sold" (and no other), Reveille's hammer on "Ring!"; the recorded cast's
// acts come from their recorded briefs at load time and only reach layers the recorded rig has; cue
// matching is at a word boundary, ignoring case, with simple endings (fast-check: a cue word put
// anywhere in a line is found at its index; a word that only contains it is not).
import fc from "fast-check";
import { parseShow } from "@sr/engine";
import { validateRig, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import lotNinetyJob from "../../../../assets/replay/forge/lot-ninety/job.json";
import reveilleJob from "../../../../assets/replay/forge/reveille/job.json";
import sirVacantJob from "../../../../assets/replay/forge/sir-vacant/job.json";
import lotNinetyNight from "../../../../assets/replay/shows/lot-ninety-night.json";
import reveilleNight from "../../../../assets/replay/shows/reveille-night.json";
import { cooled, cuePattern, lineCue, stageActs, withActs, ACT_COOLDOWN_MS } from "./acts";
import { castActs } from "./castActs";
import { sheetBible } from "./sheetShow";

const rigOf = (job: { rig: unknown }): Rig => {
  const read = validateRig(job.rig);
  if (!read.ok) throw new Error("recorded rig does not validate");
  return read.value;
};
const showOf = (json: unknown) => {
  const show = parseShow(json);
  if (show === undefined) throw new Error("show does not validate");
  return show;
};

describe("the recorded cast's acts", () => {
  it("Lot Ninety's glove fires on exactly the 'Sold' beats of his recorded show", () => {
    const rig = withActs(rigOf(lotNinetyJob), castActs("lot-ninety"));
    const acts = stageActs(rig);
    expect(acts).toEqual([{ layer: "hand_r", cue: ["sold"] }]);
    const show = showOf(lotNinetyNight);
    const fired = show.beats.flatMap((b, i) => (lineCue(b.reply.line, acts) === undefined ? [] : [i]));
    const sold = show.beats.flatMap((b, i) => (/\bsold\b/i.test(b.reply.line) ? [i] : []));
    expect(sold.length).toBe(3);
    expect(fired).toEqual(sold);
    for (const i of fired) {
      const line = show.beats[i]?.reply.line ?? "";
      const cue = lineCue(line, acts);
      expect(line.slice(cue?.index ?? 0).toLowerCase().startsWith("sold")).toBe(true);
      expect(cue?.at).toBeCloseTo((cue?.index ?? 0) / line.length, 12);
    }
  });

  it("Reveille's hammer fires on 'Ring!'", () => {
    const acts = stageActs(withActs(rigOf(reveilleJob), castActs("reveille")));
    expect(acts).toEqual([{ layer: "hammer", cue: ["ring"] }]);
    expect(showOf(reveilleNight).beats.some((b) => lineCue(b.reply.line, acts) !== undefined)).toBe(true);
    expect(lineCue("Ring! Ring!", acts)?.index).toBe(0);
  });

  it("only reaches layers the recorded rig has, and leaves the recorded rig untouched", () => {
    const sir = rigOf(sirVacantJob);
    expect([...castActs("sir-vacant").keys()].sort()).toEqual(["inner_light", "vow_tags"]);
    expect(withActs(sir, castActs("sir-vacant"))).toBe(sir);
    expect(castActs("malakor").size).toBe(0);
    const lot = rigOf(lotNinetyJob);
    withActs(lot, castActs("lot-ninety"));
    expect(lot.layers.some((l) => l.act !== undefined)).toBe(false);
  });

  it("a rig's own act wins over a derived one", () => {
    const rig = rigOf(lotNinetyJob);
    const own = { ...rig, layers: rig.layers.map((l) => (l.name === "hand_r" ? { ...l, act: { cue: ["gavel"] } } : l)) };
    expect(withActs(own, castActs("lot-ninety"))).toBe(own);
  });
});

const arbWord = fc.stringMatching(/^[a-z]{3,10}$/);
const arbFiller = fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 8 });

describe("cue matching", () => {
  it("finds a cue word, any case, with a simple ending, at its index", () => {
    fc.assert(
      fc.property(arbWord, arbFiller, arbFiller, fc.constantFrom("", "s", "ed", "ing", "!", "?!"), fc.boolean(), (word, before, after, end, upper) => {
        fc.pre(![...before, ...after].some((w) => cuePattern(word).test(w)));
        const said = upper ? word.toUpperCase() : word;
        const head = before.length === 0 ? "" : `${before.join(" ")} `;
        const line = `${head}${said}${end} ${after.join(" ")}`.trim();
        expect(lineCue(line, [{ layer: "hand_r", cue: [word] }])).toEqual({ layer: "hand_r", index: head.length, at: head.length / line.length });
      }),
    );
  });

  it("does not fire inside a longer word", () => {
    const acts = [{ layer: "hand_r", cue: ["sold"] }];
    expect(lineCue("The soldier resold it.", acts)).toBeUndefined();
    expect(lineCue("SOLD!", acts)?.index).toBe(0);
    expect(lineCue("count the country", [{ layer: "p", cue: ["count"] }])?.index).toBe(0);
    expect(lineCue("the country", [{ layer: "p", cue: ["count"] }])).toBeUndefined();
  });

  it("keeps the cooldown between two acts", () => {
    expect(cooled(undefined, 0)).toBe(true);
    expect(cooled(1_000, 1_000 + ACT_COOLDOWN_MS - 1)).toBe(false);
    expect(cooled(1_000, 1_000 + ACT_COOLDOWN_MS)).toBe(true);
  });
});

describe("the sheet bible names each act's cue", () => {
  it("adds one sentence per act, so the live engine says the cue word; none without acts", () => {
    const sheet = { archetype: "Auctioneer", hook: "Sells small souls.", lines: ["Going once."] };
    expect(sheetBible("Lot", sheet, [{ layer: "hand_r", cue: ["sold"] }])).toContain('Your signature move (hand r) plays when you say "sold"');
    expect(sheetBible("Lot", sheet)).not.toContain("signature move");
  });
});
