// perfection-pass task 8 (requirement 8.1): the replay matcher over the eight recorded cast briefs.
// Properties (fast-check): deterministic, an exact one_line_request wins, the cast's order never
// changes the answer, each member is reached by its own name and archetype, and requests with no
// signal spread over the cast. The table pins what a dozen plausible judge requests land on.
import fc from "fast-check";
import b_auntie_asp from "../../../assets/characters/cast/auntie-asp/brief.json";
import b_lot_ninety from "../../../assets/characters/cast/lot-ninety/brief.json";
import b_reveille from "../../../assets/characters/cast/reveille/brief.json";
import b_saint_cardia from "../../../assets/characters/cast/saint-cardia/brief.json";
import b_sir_vacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import b_the_redactor from "../../../assets/characters/cast/the-redactor/brief.json";
import b_the_tallyman from "../../../assets/characters/cast/the-tallyman/brief.json";
import b_vicar_of_the_lure from "../../../assets/characters/cast/vicar-of-the-lure/brief.json";
import { describe, expect, it } from "vitest";
import { briefFromRecorded, recordedBriefFor } from "./brief.js";
import { castMatchLine, matchCastBrief, matchWords, readCastMatchNote, recordedBriefMatch, stemWord, type CastBriefSummary } from "./briefMatch.js";
import type { CharacterBrief } from "./wire.js";

const RAW: Readonly<Record<string, unknown>> = {
  "auntie-asp": b_auntie_asp,
  "lot-ninety": b_lot_ninety,
  "reveille": b_reveille,
  "saint-cardia": b_saint_cardia,
  "sir-vacant": b_sir_vacant,
  "the-redactor": b_the_redactor,
  "the-tallyman": b_the_tallyman,
  "vicar-of-the-lure": b_vicar_of_the_lure,
};

const CAST: (CharacterBrief & { slug: string })[] = Object.entries(RAW).map(([slug, raw]) => {
  const brief = briefFromRecorded(raw);
  if (!brief.ok) throw new Error(slug);
  return { ...brief.value, slug };
});
const VOCAB = [...new Set(CAST.flatMap((b) => `${b.name} ${b.archetype} ${b.one_line_request} ${b.silhouette}`.toLowerCase().split(/[^a-z]+/)))].filter((w) => w !== "");
const castArb = fc.shuffledSubarray(CAST, { minLength: 1 });
const requestArb = fc.oneof(fc.string(), fc.array(fc.constantFrom(...VOCAB), { maxLength: 8 }).map((ws) => ws.join(" ")));
const slugOf = (request: string, cast: readonly CastBriefSummary[]) => matchCastBrief(request, cast)?.slug;

/** The judge table: request -> the recorded character it lands on, how, and the words that chose it. */
const TABLE: [string, string, string, string[]][] = [
  ["a ghost butler with white gloves", "lot-ninety", "words", ["ghost", "gloves"]],
  ["an auctioneer", "lot-ninety", "words", ["auctioneer"]],
  ["a skeleton knight in rusty armour", "sir-vacant", "words", ["knight", "armour"]],
  ["hollow knight", "sir-vacant", "words", ["hollow", "knight"]],
  ["a snake lady who hates noise", "auntie-asp", "words", ["snake"]],
  ["a medusa", "auntie-asp", "words", ["medusa"]],
  ["a fish priest from the deep", "vicar-of-the-lure", "words", ["fish", "deep"]],
  ["a sea monster", "vicar-of-the-lure", "words", ["sea", "monster"]],
  ["a clock that rings when I go live", "reveille", "words", ["clock", "rings"]],
  ["a saint made of porcelain", "saint-cardia", "words", ["saint", "porcelain"]],
  ["a glowing heart reliquary", "saint-cardia", "words", ["heart", "reliquary"]],
  ["a many-eyed accountant counting viewers", "the-tallyman", "words", ["eyed", "counting", "viewers"]],
  ["a spooky census guy that counts everyone in chat", "the-tallyman", "exact", ["census", "counts", "everyone"]],
  ["a vampire accountant", "reveille", "none", []],
  ["a pumpkin head scarecrow", "lot-ninety", "none", []],
  ["a moth woman with a veil", "vicar-of-the-lure", "none", []],
];

describe("matchCastBrief", () => {
  it("lands each judge request on the pinned character", () => {
    const got = TABLE.map(([request]) => {
      const m = matchCastBrief(request, CAST);
      return [request, m?.slug, m?.how, m?.matched];
    });
    expect(got).toEqual(TABLE);
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(requestArb, castArb, (request, cast) => {
        expect(matchCastBrief(request, cast)).toEqual(matchCastBrief(request, cast.map((b) => ({ ...b }))));
      }),
    );
  });

  it("never depends on the order of the cast", () => {
    fc.assert(
      // shuffledSubarray hands each run the members in a random order; reversed must agree.
      fc.property(requestArb, castArb, (request, cast) => {
        expect(matchCastBrief(request, cast)).toEqual(matchCastBrief(request, [...cast].reverse()));
      }),
    );
  });

  it("an exact one_line_request wins outright, whatever its case and spacing", () => {
    fc.assert(
      fc.property(castArb, fc.nat(), fc.boolean(), (cast, at, upper) => {
        const target = cast[at % cast.length];
        if (target === undefined) return;
        const asked = `  ${upper ? target.one_line_request.toUpperCase() : target.one_line_request.replace(/ /g, "   ")} `;
        const m = matchCastBrief(asked, cast);
        expect(m?.slug).toBe(target.slug);
        expect(m?.how).toBe("exact");
      }),
    );
  });

  it("reaches every cast member by its own name or its archetype, in any company", () => {
    fc.assert(
      fc.property(castArb, fc.nat(), fc.boolean(), (cast, at, byName) => {
        const target = cast[at % cast.length];
        if (target === undefined) return;
        expect(slugOf(byName ? target.name : target.archetype, cast)).toBe(target.slug);
      }),
    );
    for (const b of CAST) expect([slugOf(b.name, CAST), slugOf(b.archetype, CAST)]).toEqual([b.slug, b.slug]);
  });

  it("spreads requests with no signal over the cast instead of one character", () => {
    const picks = ["a robot", "an owl", "a vampire accountant", "a pumpkin", "a banshee", "a cowboy", "a mermaid", "a wizard", "a dragon", "a cat"].map((r) => {
      const m = matchCastBrief(r, CAST);
      expect(m?.how).toBe("none");
      return m?.slug;
    });
    expect(new Set(picks).size).toBeGreaterThanOrEqual(4);
  });

  it("a word more than half the cast holds is no reason to choose; an empty cast has no match", () => {
    expect(matchCastBrief("head jaw eye chat", CAST)?.how).toBe("none");
    expect(matchCastBrief("anything", [])).toBeUndefined();
  });
});

describe("normalisation", () => {
  it("stems plurals and -ing/-ed, folds British spellings, drops glue words", () => {
    expect(["snakes", "stories", "boxes", "counting", "haunted", "census", "glass", "armour", "string"].map(stemWord)).toEqual([
      "snake",
      "story",
      "box",
      "count",
      "haunt",
      "census",
      "glass",
      "armor",
      "string",
    ]);
    expect(matchWords("The Moth's veil, a SPOOKY one!")).toEqual([
      ["moth", "moth"],
      ["veil", "veil"],
    ]);
  });
});

describe("recordedBriefMatch and the card line", () => {
  const briefs: CharacterBrief[] = Object.values(RAW).flatMap((raw) => {
    const r = briefFromRecorded(raw);
    return r.ok ? [r.value] : [];
  });
  it("answers with the brief and a note naming what matched; recordedBriefFor agrees", () => {
    const answer = recordedBriefMatch("a fish priest from the deep", briefs);
    expect(answer?.brief.name).toBe("Vicar of the Lure");
    expect(answer?.match).toEqual({ name: "Vicar of the Lure", how: "words", matched: ["fish", "deep"] });
    expect(recordedBriefFor("a fish priest from the deep", briefs)).toBe(answer?.brief);
    expect(recordedBriefMatch("x", [])).toBeUndefined();
  });

  it("says plainly that it is a recording, and what chose it", () => {
    expect(castMatchLine({ name: "Vicar of the Lure", how: "words", matched: ["fish", "deep"] })).toBe("Recorded: Vicar of the Lure, chosen for 'fish', 'deep'.");
    expect(castMatchLine({ name: "The Tallyman", how: "exact", matched: [] })).toBe("Recorded: The Tallyman, recorded from these exact words.");
    expect(castMatchLine({ name: "Reveille", how: "none", matched: [] })).toMatch(/^Recorded: Reveille\. Nothing in your words matched/);
  });

  it("reads a note off the wire, refusing anything else", () => {
    expect(readCastMatchNote({ name: "N", how: "none", matched: [] })).toEqual({ name: "N", how: "none", matched: [] });
    expect(readCastMatchNote({ name: "N", how: "maybe", matched: [] })).toBeUndefined();
    expect(readCastMatchNote({ name: "N", how: "words", matched: [1] })).toBeUndefined();
    expect(readCastMatchNote(undefined)).toBeUndefined();
  });
});
