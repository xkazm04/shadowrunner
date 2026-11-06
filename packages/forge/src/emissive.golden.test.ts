// Emissive per layer (cast-forge task 12 follow-up, design.md "Emissive per layer"): the forge rule
// `emissiveOf` (a part gives light when it pulses or is an eye, unless its file says otherwise; the
// rule only takes light away), its parse and its live settling, and the golden: the committed cast
// rigs mark what does not glow `emissive: false` and leave what glows at the kind's default, and a
// flare raises no glove, bead or armour plate.
import { EMISSIVE_KINDS, GESTURE_DURATION_S, isEmissive, poseLayers, validateRig, type Layer, type LayerKind, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import cardiaJob from "../../../assets/replay/forge/saint-cardia/job.json";
import lotNinetyJob from "../../../assets/replay/forge/lot-ninety/job.json";
import redactorJob from "../../../assets/replay/forge/the-redactor/job.json";
import reveilleJob from "../../../assets/replay/forge/reveille/job.json";
import sirVacantJob from "../../../assets/replay/forge/sir-vacant/job.json";
import tallymanJob from "../../../assets/replay/forge/the-tallyman/job.json";
import vicarJob from "../../../assets/replay/forge/vicar-of-the-lure/job.json";
import { settleBriefParts } from "./briefParts.js";
import { emissiveOf } from "./named.js";
import { PART_ROLES, ROLE_KIND, parseParts } from "./parts.js";
import type { NamedPart, PartRole } from "./types.js";
import type { CharacterBrief } from "./wire.js";

const box: NamedPart["box_2d"] = [100, 100, 300, 300];
const poly: NamedPart["poly"] = [[100, 100], [100, 300], [300, 300], [300, 100]];
const part = (role: PartRole, extra: Partial<NamedPart> = {}): NamedPart => ({ name: "p", role, box_2d: box, poly, ...extra });
const EYES: readonly PartRole[] = ["eye", "eye_l", "eye_r"];

describe("emissiveOf (the forge rule)", () => {
  it("every role: a pulse or an eye keeps the kind's default, anything else of an emissive kind is false, no other kind gains light", () => {
    for (const role of PART_ROLES) {
      const kind = ROLE_KIND[role];
      const plain = emissiveOf(part(role), kind);
      const pulsing = emissiveOf(part(role, { motion: { pulse: { amp: 0.5, freq: 0.6 } } }), kind);
      const glows = role === "pulse" || EYES.includes(role);
      expect(plain, role).toBe(EMISSIVE_KINDS.has(kind) && !glows ? false : undefined);
      expect(pulsing, `${role} pulsing`).toBeUndefined();
      expect(emissiveOf(part(role, { matte: "plate", motion: { float: { amp: [1, 1], freq: 0.3 } } }), kind), `${role} plate`).toBe(plain);
    }
  });

  it("the part's own emissive wins, written only where it differs from the kind's default", () => {
    expect(emissiveOf(part("eye_l", { emissive: false }), "eye")).toBe(false);
    expect(emissiveOf(part("float", { emissive: true }), "accessory")).toBeUndefined();
    expect(emissiveOf(part("jaw", { emissive: true }), "jaw")).toBe(true);
    expect(emissiveOf(part("head", { emissive: false }), "head")).toBeUndefined();
    // A jaw's pulse lights its own pixels, never the glow pass (Reveille's teeth as before).
    expect(emissiveOf(part("jaw", { motion: { pulse: { amp: 0.5, freq: 1 } } }), "jaw")).toBeUndefined();
  });

  it("parseParts keeps a boolean emissive on any role and refuses anything else", () => {
    const ok = parseParts({ version: 2, parts: [{ name: "eye_l", role: "eye_l", box_2d: box, poly, emissive: false }, { name: "head", role: "head", box_2d: box, poly, emissive: true }] });
    expect(ok.ok && ok.value.named?.map((p) => p.emissive)).toEqual([false, true]);
    const bad = parseParts({ version: 2, parts: [{ name: "eye_l", role: "eye_l", box_2d: box, poly, emissive: "no" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.path)).toContain("$.parts[0].emissive");
  });

  it("settleBriefParts passes a boolean emissive through (the live path) and drops anything else", () => {
    const brief: CharacterBrief = {
      name: "Lamplighter",
      one_line_request: "a lamplighter with painted eyes",
      archetype: "Keeper",
      persona_hook: "Counts the lamps.",
      accent_hex: "#ffc040",
      silhouette: "A tall hat and a lamp.",
      parts: [{ name: "eye_l", role: "eye_l", what: "a painted eye" }, { name: "lamp", role: "accessory", what: "a lit lamp" }],
      style: { name: "Flat poster", why: "Ink outlines cut cleanly." },
      portrait_prompt: "Flat poster fills.",
    };
    const settled = settleBriefParts({ version: 2, parts: [{ name: "eye_l", role: "eye_l", box_2d: box, poly, emissive: false }, { name: "lamp", role: "accessory", box_2d: box, poly, emissive: "yes" }] }, brief);
    const parts = (settled.value as { parts: Record<string, unknown>[] }).parts;
    expect(parts[0]?.emissive).toBe(false);
    expect(parts[1]).not.toHaveProperty("emissive");
  });
});

function rigOf(job: unknown): Rig {
  const checked = validateRig((job as { rig: unknown }).rig);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return checked.value;
}

/** Per cast rig: layers that must not glow, and layers that must still glow. */
const CAST: { slug: string; job: unknown; dark: string[]; lit: string[] }[] = [
  { slug: "lot-ninety", job: lotNinetyJob, dark: ["hand_l", "hand_r", "bowtie", "collar_l", "collar_r", "hair"], lit: ["eye_l", "eye_r", "wisp_l", "wisp_r"] },
  { slug: "the-tallyman", job: tallymanJob, dark: ["abacus", "collar", "beads_1l", "beads_1r", "beads_2l", "beads_2r", "beads_3l", "beads_3r"], lit: ["eye_l1", "eye_r3", "pince_nez"] },
  { slug: "sir-vacant", job: sirVacantJob, dark: ["pauldron_l", "pauldron_r", "chain", "tag_1", "tag_2", "tag_3", "plume"], lit: ["slit_l", "slit_r"] },
  { slug: "saint-cardia", job: cardiaJob, dark: ["crown", "cage", "eye_l", "eye_r", "spire_1", "spire_5"], lit: ["heart"] },
  { slug: "reveille", job: reveilleJob, dark: ["bell_l", "bell_r", "hammer", "brow_l", "brow_r", "key"], lit: ["crack", "eye_l", "eye_r"] },
  { slug: "vicar-of-the-lure", job: vicarJob, dark: ["lure_stalk", "eye_l", "eye_r"], lit: ["lure_bulb"] },
  { slug: "the-redactor", job: redactorJob, dark: ["inkstamp"], lit: ["censor_bar", "eye_l", "eye_r"] },
];

describe.each(CAST)("cast rig $slug (golden)", ({ job, dark, lit }) => {
  const rig = rigOf(job);
  const byName = new Map(rig.layers.map((l) => [l.name, l]));
  const layer = (name: string): Layer => {
    const found = byName.get(name);
    if (found === undefined) throw new Error(`no layer ${name}`);
    // cast-face-pass: a socketed eye's light (or its unlit iris) is its iris layer's.
    const iris = found.kind === "eye" && found.socket !== undefined ? rig.layers.find((l) => l.kind === "iris" && l.follow === name) : undefined;
    return iris ?? found;
  };

  it("marks what does not glow emissive: false and leaves what glows at its kind's default", () => {
    for (const name of dark) expect(layer(name).emissive, name).toBe(false);
    for (const name of lit) expect([layer(name).emissive, isEmissive(layer(name))], name).toEqual([undefined, true]);
    // cast-face-pass: a socketed eye whose own art keeps a light beside its iris (Reveille's rings, Sir
    // Vacant's slits, WP1b's recipes) says so explicitly (`emissive: true`, socketEyes' default being false).
    const keepsLight = (l: Layer) => l.kind === "eye" && l.socket !== undefined && l.emissive === true;
    for (const l of rig.layers) if (l.emissive !== undefined && !keepsLight(l)) expect(l.emissive, l.name).toBe(!EMISSIVE_KINDS.has(l.kind as LayerKind));
  });

  it("a flare raises the lights, never a dark layer (its own pulse aside)", () => {
    const look = { palette: rig.palette, hidden: [], emotion: "neutral" as const };
    const drive = { t: 5, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, still: true };
    const rest = new Map(poseLayers(rig, look, drive).map((p) => [p.name, p.tint]));
    const flare = new Map(poseLayers(rig, look, { ...drive, gesture: { name: "flare", startedAt: 5 - GESTURE_DURATION_S / 2 } }).map((p) => [p.name, p.tint]));
    for (const name of dark) expect(flare.get(layer(name).name), name).toBe(rest.get(layer(name).name));
    for (const name of lit) expect(flare.get(layer(name).name), name).toBeCloseTo(2 * (rest.get(layer(name).name) ?? NaN), 9);
  });
});
