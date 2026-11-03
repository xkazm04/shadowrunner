// cast-forge task 12 (requirement 5, closing task 11's limits): the brief contract fits what the
// eight proved. Each recorded contest brief (through `briefFromRecorded`) and each committed
// decomposition (cast/<slug>/parts.json, its parts planned as a brief: name, role, follow and the
// recorded words) is a brief `parseBrief` accepts: the Tallyman's 18 parts fit BRIEF_MAX_PARTS and
// Reveille's teeth are a second jaw-role part that follows the jaw. Everything else stays strict.
import p_auntie_asp from "../../../assets/characters/cast/auntie-asp/parts.json";
import b_auntie_asp from "../../../assets/characters/cast/auntie-asp/brief.json";
import p_lot_ninety from "../../../assets/characters/cast/lot-ninety/parts.json";
import b_lot_ninety from "../../../assets/characters/cast/lot-ninety/brief.json";
import p_reveille from "../../../assets/characters/cast/reveille/parts.json";
import b_reveille from "../../../assets/characters/cast/reveille/brief.json";
import p_saint_cardia from "../../../assets/characters/cast/saint-cardia/parts.json";
import b_saint_cardia from "../../../assets/characters/cast/saint-cardia/brief.json";
import p_sir_vacant from "../../../assets/characters/cast/sir-vacant/parts.json";
import b_sir_vacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import p_the_redactor from "../../../assets/characters/cast/the-redactor/parts.json";
import b_the_redactor from "../../../assets/characters/cast/the-redactor/brief.json";
import p_the_tallyman from "../../../assets/characters/cast/the-tallyman/parts.json";
import b_the_tallyman from "../../../assets/characters/cast/the-tallyman/brief.json";
import p_vicar_of_the_lure from "../../../assets/characters/cast/vicar-of-the-lure/parts.json";
import b_vicar_of_the_lure from "../../../assets/characters/cast/vicar-of-the-lure/brief.json";
import { describe, expect, it } from "vitest";
import { BRIEF_MAX_PARTS, briefFromRecorded, parseBrief } from "./brief.js";
import { MAX_NAMED_PARTS } from "./parts.js";
import type { BriefPart, CharacterBrief } from "./wire.js";

interface FilePart {
  name: string;
  role: string;
  follow?: string;
  motion?: unknown;
}
const CAST: Readonly<Record<string, { brief: unknown; parts: { parts: FilePart[] } }>> = {
  "auntie-asp": { brief: b_auntie_asp, parts: p_auntie_asp },
  "lot-ninety": { brief: b_lot_ninety, parts: p_lot_ninety },
  "reveille": { brief: b_reveille, parts: p_reveille },
  "saint-cardia": { brief: b_saint_cardia, parts: p_saint_cardia },
  "sir-vacant": { brief: b_sir_vacant, parts: p_sir_vacant },
  "the-redactor": { brief: b_the_redactor, parts: p_the_redactor },
  "the-tallyman": { brief: b_the_tallyman, parts: p_the_tallyman },
  "vicar-of-the-lure": { brief: b_vicar_of_the_lure, parts: p_vicar_of_the_lure },
};
const SLUGS = Object.keys(CAST).sort();

const recorded = (slug: string): CharacterBrief => {
  const r = briefFromRecorded(CAST[slug]?.brief);
  if (!r.ok) throw new Error(`${slug}: ${JSON.stringify(r.errors)}`);
  return r.value;
};

/** The decomposition's parts as a brief's plan (as scripts/cast/live-proof.mjs plans it). */
const planOf = (slug: string): unknown => {
  const base = recorded(slug);
  const words = new Map(base.parts.map((p) => [p.name, p]));
  const parts = (CAST[slug]?.parts.parts ?? []).map((p) => ({
    name: p.name,
    role: p.role,
    what: words.get(p.name)?.what ?? p.name.replaceAll("_", " "),
    ...(p.motion === undefined ? {} : { motion: words.get(p.name)?.motion ?? "moves on its own" }),
    ...(p.follow === undefined ? {} : { follow: p.follow }),
  }));
  return { ...base, parts };
};

describe("the eight are plannable by a brief", () => {
  it.each(SLUGS)("%s: the recorded brief and the committed parts.json both parse as briefs", (slug) => {
    expect(recorded(slug).parts.length).toBeLessThanOrEqual(BRIEF_MAX_PARTS);
    const plan = parseBrief(planOf(slug));
    expect(plan.ok ? "ok" : JSON.stringify(plan.errors)).toBe("ok");
    expect(plan.ok && plan.value.parts.length).toBe(CAST[slug]?.parts.parts.length);
  });

  it("the cap holds the largest of the eight and stays under the v2 parts file's", () => {
    const largest = Math.max(...SLUGS.map((s) => CAST[s]?.parts.parts.length ?? 0));
    expect(largest).toBe(18); // the Tallyman
    expect(BRIEF_MAX_PARTS).toBeGreaterThanOrEqual(largest);
    expect(BRIEF_MAX_PARTS).toBeLessThan(MAX_NAMED_PARTS);
  });
});

describe("a second jaw-role part", () => {
  const base = recorded("the-redactor");
  const teeth: BriefPart = { name: "teeth", role: "jaw", what: "a row of teeth", follow: "jaw" };
  const withParts = (...extra: BriefPart[]) => ({ ...base, parts: [...base.parts, ...extra] });

  it("is accepted when it follows the jaw (a teeth or lip set)", () => {
    expect(parseBrief(withParts(teeth)).ok).toBe(true);
  });

  it.each([
    ["it does not follow the jaw", [{ ...teeth, follow: "head" }]],
    ["it follows nothing", [{ name: "teeth", role: "jaw", what: "teeth" }]],
    ["there is a third", [teeth, { ...teeth, name: "lip" }]],
  ] as const)("is refused when %s", (_, extra) => {
    const r = parseBrief(withParts(...(extra as readonly BriefPart[])));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.path === "$.parts" && e.message.includes("jaw"))).toBe(true);
  });

  it("is refused when the parts pass the cap", () => {
    const many = Array.from({ length: BRIEF_MAX_PARTS - base.parts.length + 1 }, (_, i): BriefPart => ({ name: `tag_${i}`, role: "float", what: "a tag" }));
    expect(parseBrief(withParts(...many)).ok).toBe(false);
    expect(parseBrief(withParts(...many.slice(1))).ok).toBe(true);
  });
});
