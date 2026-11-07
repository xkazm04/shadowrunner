// tiger L1: signature acts from the brief's words. On the eight cast briefs exactly Lot Ninety,
// Reveille, Sir Vacant, the Redactor and the Tallyman get acts (Auntie Asp's "turn toward whoever
// speaks" is gaze, not an act); a compiled act never names a missing layer, never sits on a role
// that may not carry one, and always reads back through readAct unchanged; settleBriefParts puts
// it on the part and parseParts keeps it.
import fc from "fast-check";
import { readAct } from "@sr/rig";
import { describe, expect, it } from "vitest";
import auntieAsp from "../../../assets/characters/cast/auntie-asp/brief.json";
import lotNinety from "../../../assets/characters/cast/lot-ninety/brief.json";
import reveille from "../../../assets/characters/cast/reveille/brief.json";
import saintCardia from "../../../assets/characters/cast/saint-cardia/brief.json";
import sirVacant from "../../../assets/characters/cast/sir-vacant/brief.json";
import theRedactor from "../../../assets/characters/cast/the-redactor/brief.json";
import theTallyman from "../../../assets/characters/cast/the-tallyman/brief.json";
import vicar from "../../../assets/characters/cast/vicar-of-the-lure/brief.json";
import { assembleRig } from "./assemble.js";
import { briefFromRecorded } from "./brief.js";
import { ACT_ROLES, actFromWords, actLine, actsFromParts, actsFromRecordedParts, stemCue } from "./briefActs.js";
import { settleBriefParts } from "./briefParts.js";
import { cutNamed } from "./cutNamed.js";
import { PART_ROLES, parseParts } from "./parts.js";
import type { NamedPart, PartRole, Rgba } from "./types.js";

const CAST: Record<string, { parts: unknown }> = {
  "auntie-asp": auntieAsp,
  "lot-ninety": lotNinety,
  reveille,
  "saint-cardia": saintCardia,
  "sir-vacant": sirVacant,
  "the-redactor": theRedactor,
  "the-tallyman": theTallyman,
  "vicar-of-the-lure": vicar,
};

const briefOf = (slug: string) => {
  const read = briefFromRecorded(CAST[slug]);
  if (!read.ok) throw new Error(`${slug}: brief does not read`);
  return read.value;
};

describe("actFromWords on the cast briefs", () => {
  it("gives acts to exactly Lot Ninety, Reveille, Sir Vacant, the Redactor and the Tallyman", () => {
    const acts = Object.fromEntries(Object.keys(CAST).map((slug) => [slug, Object.fromEntries(actsFromParts(briefOf(slug).parts))]));
    expect(acts).toEqual({
      "auntie-asp": {},
      "lot-ninety": { hand_r: { cue: ["sold"] } },
      reveille: { hammer: { cue: ["ring"] } },
      "saint-cardia": {},
      "sir-vacant": { inner_light: { cue: ["vow"] }, vow_tags: { cue: ["goal"] } },
      "the-redactor": { inkstamp: { cue: ["approved"] } },
      "the-tallyman": { pince_nez: { cue: ["count"] } },
      "vicar-of-the-lure": {},
    });
  });

  it("actsFromRecordedParts reads the raw recorded parts the same way", () => {
    for (const slug of Object.keys(CAST)) expect(actsFromRecordedParts(CAST[slug]?.parts)).toEqual(actsFromParts(briefOf(slug).parts));
    expect(actsFromRecordedParts("nope").size).toBe(0);
  });

  it("reads the event phrasings honestly", () => {
    expect(actFromWords("hand_r", "float", "floats, points, 'sold' slam")).toEqual({ cue: ["sold"] });
    expect(actFromWords("hammer", "float", "vibrates side to side when ringing")).toEqual({ cue: ["ring"] });
    expect(actFromWords("bell", "crown", "shakes whenever it rings")).toEqual({ cue: ["rings"] });
    expect(actFromWords("stamp", "accessory", "Swings and thunks when something is approved.")).toEqual({ cue: ["approved"] });
    expect(actFromWords("glow", "pulse", "brightens on open")).toBeUndefined();
    expect(actFromWords("serpent", "float", "each sways on its own, they turn toward whoever speaks")).toBeUndefined();
    expect(actFromWords("head", "head", "shakes when ringing")).toBeUndefined();
    expect(actFromWords("eye_l", "eye_l", "flares when angry")).toBeUndefined();
    expect(stemCue("running")).toBe("run");
    expect(stemCue("spelling")).toBe("spell");
    expect(actLine("hand_r", { cue: ["sold", "gone"] })).toBe('hand_r: on "sold" or "gone"');
  });
});

const arbRole: fc.Arbitrary<PartRole> = fc.constantFrom(...PART_ROLES);
const arbWords = fc.array(fc.constantFrom("floats", "when", "a", "vow", "is", "kept", "'sold'", "slam", "ringing", "toward", "the", "speaker", ",", ";", "every time", "\"bang\"", "x"), { maxLength: 12 }).map((w) => w.join(" "));

describe("actFromWords properties", () => {
  it("a compiled act never names a missing layer, sits only on an act role, and reads back unchanged", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ name: fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/), role: arbRole, motion: arbWords }), { maxLength: 8 }), (parts) => {
        const acts = actsFromParts(parts);
        for (const [name, act] of acts) {
          const part = parts.find((p) => p.name === name);
          expect(part).toBeDefined();
          expect(ACT_ROLES).toContain(part?.role);
          expect(readAct(act)).toEqual(act);
        }
      }),
    );
  });
});

describe("settleBriefParts carries the act to the parsed part", () => {
  it("Lot Ninety's right glove gets its 'sold' act; nothing else does", () => {
    const brief = briefOf("lot-ninety");
    const box = [100, 100, 300, 300];
    const poly = [[100, 100], [100, 300], [300, 300], [300, 100]];
    const answer = { version: 2, parts: brief.parts.map((p) => ({ name: p.name, role: p.role, box_2d: box, poly })) };
    const settled = settleBriefParts(answer, brief);
    expect(settled.notes).toContain("a signature act from the brief's words for 1 part(s)");
    const parsed = parseParts(settled.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const withAct = (parsed.value.named ?? []).filter((p) => p.act !== undefined);
    expect(withAct.map((p) => [p.name, p.act])).toEqual([["hand_r", { cue: ["sold"] }]]);
  });
});

describe("assembleRig puts the act on the layer", () => {
  it("a live-forged rig carries Layer.act on the part that has one, and it validates", () => {
    const square: [number, number][] = [[100, 100], [100, 900], [900, 900], [900, 100]];
    const small: [number, number][] = [[400, 400], [400, 600], [600, 600], [600, 400]];
    const parts: NamedPart[] = [
      { name: "face", role: "head", box_2d: [0, 0, 1000, 1000], poly: [[0, 0], [0, 1000], [100, 500]] },
      { name: "robe", role: "torso", box_2d: [0, 0, 1000, 1000], poly: square },
      { name: "glove", role: "float", box_2d: [0, 0, 1000, 1000], poly: small, act: { cue: ["sold"] } },
    ];
    const portrait: Rgba = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4).fill(180) };
    const result = assembleRig(parts, cutNamed(portrait, parts).layers, { id: "a", name: "A", portrait });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rig.layers.filter((l) => l.act !== undefined).map((l) => [l.name, l.act])).toEqual([["glove", { cue: ["sold"] }]]);
  });
});
