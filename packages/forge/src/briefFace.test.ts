// forge-creator C3: the brief's optional `face.eyes` ("Its eyes are ..."). Recorded cast briefs carry
// none and still validate; a brief with the line round-trips through parseBriefJson and the job
// record; an over-long, empty or misshapen line is refused with a named rule; the job record's retry
// counters stay inside their caps.
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
import { BRIEF_LIMITS, BRIEF_PROMPT, BRIEF_SCHEMA, briefFromRecorded, parseBrief } from "./brief.js";
import { MAX_EXTRA_EDITS, MAX_FACE_ATTEMPT } from "./faceMaterial.js";
import { parseBriefJson, parseForgeJob } from "./validate.js";
import type { CharacterBrief } from "./wire.js";

const CAST = [b_auntie_asp, b_lot_ninety, b_reveille, b_saint_cardia, b_sir_vacant, b_the_redactor, b_the_tallyman, b_vicar_of_the_lure];

const BRIEF: CharacterBrief = {
  name: "Sir Hollow",
  one_line_request: "an empty knight's helm that keeps watch over chat",
  archetype: "Empty knight",
  persona_hook: "Speaks from inside the helm, slow and courteous.",
  accent_hex: "#f4f1ff",
  silhouette: "A great-helm on a gorget.",
  parts: [
    { name: "helm", role: "head", what: "pewter great-helm" },
    { name: "bevor", role: "jaw", what: "bevor plate" },
    { name: "slit_l", role: "eye_l", what: "left visor slit" },
    { name: "slit_r", role: "eye_r", what: "right visor slit" },
    { name: "plume", role: "float", what: "a tattered plume", motion: "sways", follow: "helm" },
    { name: "gorget", role: "torso", what: "steel gorget" },
  ],
  style: { name: "Faceted painting", why: "Facets cut cleanly." },
  portrait_prompt: "Faceted painting. An empty great-helm with star-white light in two visor slits.",
};
const EYES = "two narrow visor slits with star-white light shining through them";

describe("brief face.eyes", () => {
  it("the eight recorded cast briefs still validate, without a face", () => {
    for (const raw of CAST) {
      const r = briefFromRecorded(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.face).toBeUndefined();
    }
  });

  it("a brief with the eyes line round-trips through parseBriefJson, trimmed; the recorded adapter keeps it too", () => {
    const brief = { ...BRIEF, face: { eyes: EYES } };
    expect(parseBriefJson(JSON.stringify(brief))).toEqual({ ok: true, value: brief });
    expect(parseBrief({ ...BRIEF, face: { eyes: `  ${EYES}  ` } })).toEqual({ ok: true, value: brief });
    const cardia = briefFromRecorded({ ...b_saint_cardia, face: { eyes: "two ruby glass beads" } });
    expect(cardia.ok && cardia.value.face).toEqual({ eyes: "two ruby glass beads" });
  });

  it("refuses an over-long, an empty or a misshapen line, each with a named rule", () => {
    const over = parseBrief({ ...BRIEF, face: { eyes: "x".repeat(BRIEF_LIMITS.eyes + 1) } });
    expect(over).toEqual({ ok: false, errors: [{ path: "$.face.eyes", message: "must be at most 200 characters" }] });
    expect(parseBrief({ ...BRIEF, face: { eyes: " " } })).toEqual({ ok: false, errors: [{ path: "$.face.eyes", message: "must not be empty" }] });
    expect(parseBrief({ ...BRIEF, face: "glass" })).toEqual({ ok: false, errors: [{ path: "$.face", message: "must be an object with eyes" }] });
    expect(parseBrief({ ...BRIEF, face: {} })).toEqual({ ok: false, errors: [{ path: "$.face.eyes", message: "must be a string" }] });
  });

  it("the prompt asks for it only for eyes that are not human; the schema offers it without requiring it", () => {
    expect(BRIEF_PROMPT("a pumpkin")).toContain("When the eyes are not ordinary human eyes, face.eyes says in under 200 characters what its eyes are made of and must stay");
    expect(BRIEF_SCHEMA.properties.face.required).toEqual(["eyes"]);
    expect((BRIEF_SCHEMA.required as readonly string[]).includes("face")).toBe(false);
  });

  it("fast-check: any line within the limit is accepted trimmed; any past it is refused at $.face.eyes", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 260 }), (eyes) => {
        const r = parseBrief({ ...BRIEF, face: { eyes } });
        const t = eyes.trim();
        if (t === "" || t.length > BRIEF_LIMITS.eyes) return !r.ok && r.errors.every((e) => e.path === "$.face.eyes");
        return r.ok && r.value.face?.eyes === t;
      }),
    );
  });
});

describe("job record with C3 fields", () => {
  const job = (extra: Record<string, unknown>): string =>
    JSON.stringify({ jobId: "j", plane: "live", mode: "brief", status: "expressing", createdAt: 1, brief: { ...BRIEF, face: { eyes: EYES } }, expressionIndex: 2, ...extra });

  it("keeps the brief's face, expressionAttempt and extraEdits", () => {
    const parsed = parseForgeJob(job({ expressionAttempt: 1, extraEdits: 3 }));
    expect(parsed?.brief?.face).toEqual({ eyes: EYES });
    expect(parsed?.expressionAttempt).toBe(1);
    expect(parsed?.extraEdits).toBe(3);
    expect(parseForgeJob(job({}))).toBeDefined();
  });

  it("refuses counters outside their caps (0 is omitted, never stored)", () => {
    for (const bad of [0, MAX_FACE_ATTEMPT + 1, 1.5, -1, "1"]) expect(parseForgeJob(job({ expressionAttempt: bad })), String(bad)).toBeUndefined();
    for (const bad of [0, MAX_EXTRA_EDITS + 1, 2.5, "2"]) expect(parseForgeJob(job({ extraEdits: bad })), String(bad)).toBeUndefined();
  });
});
