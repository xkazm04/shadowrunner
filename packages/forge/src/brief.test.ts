// cast-forge task 10 (requirement 4.1-4.2): the exact BRIEF_PROMPT, parseBrief over every field and
// range (fast-check: every well-formed brief passes, every seeded malformation is refused), the
// recorded contest briefs adapted to CharacterBrief, and the portrait prompt built from a brief.
import fc from "fast-check";
import design from "../../../.kiro/specs/cast-forge/design.md?raw";
import b_auntie_asp from "../../../assets/characters/cast/auntie-asp/brief.json";
import b_lot_ninety from "../../../assets/characters/cast/lot-ninety/brief.json";
import b_reveille from "../../../assets/characters/cast/reveille/brief.json";
import b_saint_cardia from "../../../assets/characters/cast/saint-cardia/brief.json";
import b_sir_vacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import b_the_redactor from "../../../assets/characters/cast/the-redactor/brief.json";
import b_the_tallyman from "../../../assets/characters/cast/the-tallyman/brief.json";
import b_vicar_of_the_lure from "../../../assets/characters/cast/vicar-of-the-lure/brief.json";
import { describe, expect, it } from "vitest";
import {
  BRIEF_HOUSE_STYLE,
  BRIEF_MAX_PARTS,
  BRIEF_PROMPT,
  briefFromRecorded,
  cutAtSentence,
  expandPartName,
  MAX_PORTRAIT_PROMPT,
  parseBrief,
  portraitPromptFromBrief,
  recordedBriefFor,
} from "./brief.js";
import { PART_ROLES } from "./parts.js";
import { parseBriefJson, parseBriefRequest, parseForgeRequest } from "./validate.js";
import type { CharacterBrief } from "./wire.js";

/** The eight recorded contest briefs, as committed (assets/characters/cast/<slug>/brief.json). */
const CAST: Readonly<Record<string, unknown>> = {
  "auntie-asp": b_auntie_asp,
  "lot-ninety": b_lot_ninety,
  "reveille": b_reveille,
  "saint-cardia": b_saint_cardia,
  "sir-vacant": b_sir_vacant,
  "the-redactor": b_the_redactor,
  "the-tallyman": b_the_tallyman,
  "vicar-of-the-lure": b_vicar_of_the_lure,
};
const SLUGS = Object.keys(CAST).sort();
const castRaw = (slug: string): unknown => CAST[slug];

const BRIEF: CharacterBrief = {
  name: "Brine",
  one_line_request: "an iron diving helmet that hums sea shanties",
  archetype: "Drowned diver",
  persona_hook: "Hums shanties between lines and counts the fathoms of chat.",
  accent_hex: "#38c8ff",
  silhouette: "A round helmet with a glowing porthole and a hose curling up.",
  parts: [
    { name: "helmet", role: "head", what: "round iron helmet" },
    { name: "jaw", role: "jaw", what: "hinged faceplate lip", motion: "drops with speech" },
    { name: "eye_l", role: "eye_l", what: "left porthole eye" },
    { name: "eye_r", role: "eye_r", what: "right porthole eye" },
    { name: "hose", role: "float", what: "curling air hose", motion: "drifts", follow: "helmet" },
    { name: "suit", role: "torso", what: "canvas diving suit" },
  ],
  style: { name: "Low-poly 3D", why: "Planes cut cleanly." },
  portrait_prompt: "Low-poly planes. An iron diving helmet with two porthole eyes and a curling hose.",
};

describe("BRIEF_PROMPT", () => {
  it("is the design.md text, verbatim, with the request appended", () => {
    const quoted = /`BRIEF_PROMPT\(request\)` \(exact[^)]*\):\n"([\s\S]*?)"\n/.exec(design.replace(/\r\n/g, "\n"))?.[1];
    expect(quoted).toBeDefined();
    const expected = (quoted ?? "").split("\n").join(" ").replace("<request>", "a lich");
    expect(BRIEF_PROMPT("a lich")).toBe(expected);
  });

  it("cuts the request to 400 characters", () => {
    const long = "x".repeat(450);
    expect(BRIEF_PROMPT(long).endsWith(`Request: ${"x".repeat(400)}`)).toBe(true);
  });
});

describe("parseBrief", () => {
  it("accepts a well-formed brief and returns it unchanged", () => {
    expect(parseBrief(BRIEF)).toEqual({ ok: true, value: BRIEF });
  });

  it("trims text, lower-cases hex, omits absent optionals and ignores unknown fields", () => {
    const r = parseBrief({ ...BRIEF, name: "  Brine ", accent_hex: "#38C8FF", extra: 1 });
    expect(r.ok && r.value.name).toBe("Brine");
    expect(r.ok && r.value.accent_hex).toBe("#38c8ff");
    expect(r.ok && "secondary_hex" in r.value).toBe(false);
    expect(r.ok && "extra" in r.value).toBe(false);
  });

  it("reports every broken rule with a path, never the value", () => {
    const r = parseBrief({ ...BRIEF, accent_hex: "red", style: { name: "x" }, portrait_prompt: "p".repeat(901) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path)).toEqual(["$.accent_hex", "$.portrait_prompt", "$.style.why"]);
    for (const e of r.errors) expect(e.message).not.toContain("red");
  });

  it("refuses a follow cycle and a follow of itself", () => {
    const cyc = BRIEF.parts.map((p) => (p.name === "helmet" ? { ...p, follow: "hose" } : p));
    expect(parseBrief({ ...BRIEF, parts: cyc }).ok).toBe(false);
    const self = BRIEF.parts.map((p) => (p.name === "hose" ? { ...p, follow: "hose" } : p));
    expect(parseBrief({ ...BRIEF, parts: self }).ok).toBe(false);
  });
});

// --- fast-check: generated well-formed briefs, and one seeded malformation each -------------------
const word = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/);
const hex = fc.stringMatching(/^#[0-9a-fA-F]{6}$/);
const EXTRA_ROLES = PART_ROLES.filter((r) => r !== "head" && r !== "jaw");
const arbBrief: fc.Arbitrary<CharacterBrief> = fc
  .record({
    name: word,
    request: word,
    accent: hex,
    secondary: fc.option(hex, { nil: undefined }),
    extra: fc.array(fc.record({ role: fc.constantFrom(...EXTRA_ROLES), motion: fc.option(word, { nil: undefined }), follows: fc.boolean() }), { minLength: 2, maxLength: 12 }),
    prompt: fc.string({ minLength: 1, maxLength: MAX_PORTRAIT_PROMPT }).filter((s) => s.trim() !== ""),
  })
  .map(({ name, request, accent, secondary, extra, prompt }) => ({
    name,
    one_line_request: request,
    archetype: "Ghost",
    persona_hook: "Haunts the chat.",
    accent_hex: accent.toLowerCase(),
    ...(secondary === undefined ? {} : { secondary_hex: secondary.toLowerCase() }),
    silhouette: "A tall shape.",
    parts: [
      { name: "head", role: "head" as const, what: "a face" },
      { name: "jaw", role: "jaw" as const, what: "a jaw" },
      { name: "eye_l", role: "eye_l" as const, what: "an eye" },
      { name: "torso", role: "torso" as const, what: "a robe" },
      ...extra.map((x, i) => ({ name: `part_${i}`, role: x.role, what: "a piece", ...(x.motion === undefined ? {} : { motion: x.motion }), ...(x.follows ? { follow: "head" } : {}) })),
    ],
    style: { name: "Pixel art", why: "Pixels cut clean." },
    portrait_prompt: prompt.trim(),
  }));

type Fault = (b: CharacterBrief) => unknown;
const withPart = (b: CharacterBrief, i: number, patch: Record<string, unknown>) => ({ ...b, parts: b.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
const FAULTS: Readonly<Record<string, Fault>> = {
  "accent is not #rrggbb": (b) => ({ ...b, accent_hex: b.accent_hex.slice(0, 4) }),
  "secondary is not #rrggbb": (b) => ({ ...b, secondary_hex: "#12345g" }),
  "too few parts": (b) => ({ ...b, parts: b.parts.slice(0, 5) }),
  "too many parts": (b) => ({ ...b, parts: [...b.parts, ...Array.from({ length: BRIEF_MAX_PARTS }, (_, i) => ({ name: `more_${i}`, role: "accessory", what: "x" }))] }),
  "an unknown role": (b) => withPart(b, 4, { role: "wing" }),
  "a duplicate name": (b) => withPart(b, 4, { name: b.parts[0]?.name }),
  "a name outside [a-z0-9_]": (b) => withPart(b, 4, { name: "Part-4" }),
  "a reserved name": (b) => withPart(b, 4, { name: "background" }),
  "a follow to a missing part": (b) => withPart(b, 4, { follow: "nobody" }),
  "a portrait prompt over 900": (b) => ({ ...b, portrait_prompt: "p".repeat(MAX_PORTRAIT_PROMPT + 1) }),
  "no head": (b) => ({ ...b, parts: b.parts.map((p) => (p.role === "head" ? { ...p, role: "hat" } : p)) }),
  "two jaws": (b) => withPart(b, 4, { role: "jaw" }),
  "no eye": (b) => ({ ...b, parts: b.parts.map((p) => (["eye_l", "eye_r", "eye"].includes(p.role) ? { ...p, role: "hat" } : p)) }),
  "no torso": (b) => ({ ...b, parts: b.parts.map((p) => (p.role === "torso" ? { ...p, role: "hat" } : p)) }),
  "a blank name": (b) => ({ ...b, name: "   " }),
  "a missing archetype": (b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== "archetype")),
  "a style without why": (b) => ({ ...b, style: { name: b.style.name } }),
  "a part that is not an object": (b) => ({ ...b, parts: [...b.parts.slice(0, -1), "torso"] }),
  "parts not an array": (b) => ({ ...b, parts: {} }),
  "a numeric name": (b) => ({ ...b, name: 7 }),
  "an over-long hook": (b) => ({ ...b, persona_hook: "h".repeat(401) }),
  "an empty motion": (b) => withPart(b, 4, { motion: " " }),
};

describe("parseBrief (fast-check)", () => {
  it("accepts every well-formed brief", () => {
    fc.assert(
      fc.property(arbBrief, (b) => {
        expect(parseBrief(b)).toEqual({ ok: true, value: b });
      }),
    );
  });

  it.each(Object.keys(FAULTS))("rejects a brief with %s", (fault) => {
    const corrupt = FAULTS[fault];
    if (corrupt === undefined) throw new Error("no fault");
    fc.assert(fc.property(arbBrief, (b) => parseBrief(corrupt(b)).ok === false));
  });

  it("rejects arbitrary non-brief values", () => {
    fc.assert(fc.property(fc.anything(), (v) => parseBrief(v).ok === false));
  });
});

describe("decoded text (validate.ts)", () => {
  it("parseBriefJson flags non-JSON as syntax and a bad shape as not", () => {
    const syntax = parseBriefJson("```json\n{}\n```");
    expect(!syntax.ok && syntax.errors.syntax).toBe(true);
    const shape = parseBriefJson("{}");
    expect(!shape.ok && !shape.errors.syntax).toBe(true);
    expect(parseBriefJson(JSON.stringify(BRIEF))).toEqual({ ok: true, value: BRIEF });
  });

  it("parseBriefRequest needs a non-blank request", () => {
    expect(parseBriefRequest('{"request":"  a ghost  "}')).toEqual({ ok: true, value: { request: "a ghost" } });
    expect(parseBriefRequest('{"request":"   "}').ok).toBe(false);
    expect(parseBriefRequest("[]").ok).toBe(false);
  });

  it("POST /api/forge mode brief carries a checked brief, and refuses an invalid one", () => {
    expect(parseForgeRequest(JSON.stringify({ mode: "brief", brief: BRIEF }))).toEqual({ ok: true, value: { mode: "brief", brief: BRIEF } });
    const bad = parseForgeRequest(JSON.stringify({ mode: "brief", brief: { ...BRIEF, accent_hex: "x" } }));
    expect(!bad.ok && bad.errors.message).toBe("The brief is not valid: $.accent_hex must be a #rrggbb colour.");
  });
});

describe("recorded contest briefs", () => {
  it("there are eight, and each adapts to a valid CharacterBrief", () => {
    expect(SLUGS).toHaveLength(8);
    for (const slug of SLUGS) {
      const r = briefFromRecorded(castRaw(slug));
      expect(r.ok ? "ok" : `${slug}: ${JSON.stringify(r.errors)}`).toBe("ok");
    }
  });

  it("maps contest kinds to roles and expands ranged names", () => {
    const asp = briefFromRecorded(castRaw("auntie-asp"));
    if (!asp.ok) throw new Error("auntie-asp");
    expect(asp.value.parts.filter((p) => p.role === "hair").map((p) => p.name)).toEqual(["serpent_l1", "serpent_l2", "serpent_l3", "serpent_r1", "serpent_r2", "serpent_r3"]);
    expect(asp.value.parts.find((p) => p.name === "jaw")?.role).toBe("jaw");
    expect(asp.value.parts.find((p) => p.name === "cardigan")?.role).toBe("torso");
    expect(asp.value.parts.find((p) => p.name === "eye_l")?.role).toBe("eye_l");
    const tally = briefFromRecorded(castRaw("the-tallyman"));
    expect(tally.ok && tally.value.parts.filter((p) => p.role === "eye").length).toBe(6);
    expect(tally.ok && tally.value.parts.find((p) => p.name === "mouth_glow")?.role).toBe("pulse");
    expect(expandPartName("eye_l")).toEqual(["eye_l"]);
  });

  it("cuts the recorded style prompt at a sentence end to 900 characters", () => {
    const cardia = briefFromRecorded(castRaw("saint-cardia"));
    if (!cardia.ok) throw new Error("saint-cardia");
    expect(cardia.value.portrait_prompt.length).toBeLessThanOrEqual(MAX_PORTRAIT_PROMPT);
    expect(cardia.value.portrait_prompt.endsWith(".")).toBe(true);
    expect(cutAtSentence("One. Two. Three.", 10)).toBe("One. Two.");
    expect(cutAtSentence("abcdefghijkl", 5)).toBe("abcde");
  });

  it("a request matches its recorded brief ignoring case and spacing, else the nearest (briefMatch.test.ts)", () => {
    const briefs = SLUGS.flatMap((slug) => {
      const r = briefFromRecorded(castRaw(slug));
      return r.ok ? [r.value] : [];
    });
    expect(recordedBriefFor("  A Spooky   census guy that counts everyone in CHAT ", briefs)?.name).toBe("The Tallyman");
    expect(recordedBriefFor("a fish priest from the deep", briefs)?.name).toBe("Vicar of the Lure");
    expect(recordedBriefFor("x", [])).toBeUndefined();
  });
});

describe("portraitPromptFromBrief", () => {
  const prompt = portraitPromptFromBrief(BRIEF);
  it("keeps the rig-fitness framing and replaces painterly realism with the brief's style", () => {
    expect(BRIEF_HOUSE_STYLE).not.toContain("painterly realism");
    expect(BRIEF_HOUSE_STYLE).toContain("in the brief's art style");
    for (const rule of ["facing the camera, centred, symmetrical", "the jaw and eyes clearly visible", "near-black (#050505) empty background"]) expect(prompt).toContain(rule);
  });
  it("names the style, carries the brief's prompt, the hard-edge rule and every planned part", () => {
    expect(prompt).toContain("Art style: Low-poly 3D.");
    expect(prompt).toContain(BRIEF.portrait_prompt);
    expect(prompt).toContain("Hard edges, never soft painterly realism");
    expect(prompt).toContain("separate shape with a clear dark gap around it: helmet, jaw, eye l, eye r, hose, suit.");
  });
});
