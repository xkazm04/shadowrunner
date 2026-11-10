// Rig.morph on the wire (companion-lanes requirement 1): validateRig accepts a portrait-lane rig and
// refuses each malformed morph with an error naming the field; serializeRig round-trips it, in
// contract order, and a rig without it keeps no `morph` key.
import { describe, expect, it } from "vitest";
import { parseRigJson, validateRig, type RigErrorCode } from "../validate.js";
import { serializeRig } from "../serialize.js";
import type { MorphKey, Rig } from "../types.js";
import { MORPH_KEYS, morphRig } from "./morphRig.js";

type Edit = (rig: Record<string, unknown>, morph: Record<string, unknown>, keys: Record<string, unknown>[]) => void;

/** The rig as decoded JSON, edited. */
function edited(edit: Edit): unknown {
  const rig = JSON.parse(serializeRig(morphRig())) as Record<string, unknown>;
  const morph = rig.morph as Record<string, unknown>;
  edit(rig, morph, morph.keys as Record<string, unknown>[]);
  return rig;
}

const key = (over: Partial<MorphKey>): Record<string, unknown> => ({ id: "extra", track: "teeth", bbox: [100, 150, 60, 40], cell: [0, 0, 10, 10], ...over });

describe("validateRig: morph accepted", () => {
  it.each<[string, Edit]>([
    ["the fixture", () => undefined],
    ["no flow when no key moves", (_r, m, k) => {
      delete m.flow;
      for (const x of k) {
        delete x.flowCell;
        delete x.flowMax;
      }
    }],
    ["no sway", (_r, m) => void delete m.sway],
    ["at 1 written out, a single key without motion, no flow", (_r, m) => {
      m.keys = [key({ id: "solo", at: 1 })];
      delete m.flow;
    }],
    ["four stops on one track", (_r, m, k) => void k.push(key({ id: "b1", track: "blink", at: 0.25 }), key({ id: "b2", track: "blink", at: 0.75 }))],
    ["sway amp at the 5 % cap", (_r, m) => void (m.sway = { map: "s.png", amp: 0.05 * 256 })],
    ["a data: URL atlas", (_r, m) => void (m.atlas = "data:image/webp;base64,AAAA")],
  ])("%s", (_label, edit) => {
    const result = validateRig(edited(edit));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});

describe("validateRig: morph refused, the field named", () => {
  it.each<[string, Edit, RigErrorCode, string]>([
    ["not an object", (r) => void (r.morph = 3), "bad_shape", "$.morph"],
    ["an unknown layer", (_r, m) => void (m.layer = "face"), "bad_shape", "$.morph.layer"],
    ["a layer that is not a head", (_r, m) => void (m.layer = "body"), "bad_shape", "$.morph.layer"],
    ["a hidden head", (r) => void (((r.layers as Record<string, unknown>[])[2] as Record<string, unknown>).visible = false), "bad_shape", "$.morph.layer"],
    ["a duplicate id", (_r, _m, k) => void ((k[1] as Record<string, unknown>).id = "blink_half"), "duplicate_name", "$.morph.keys[1].id"],
    ["a bad id", (_r, _m, k) => void ((k[0] as Record<string, unknown>).id = "Blink"), "bad_shape", "$.morph.keys[0].id"],
    ["an unknown track", (_r, _m, k) => void ((k[2] as Record<string, unknown>).track = "smile"), "bad_shape", "$.morph.keys[2].track"],
    ["at 0", (_r, _m, k) => void ((k[0] as Record<string, unknown>).at = 0), "bad_shape", "$.morph.keys[0].at"],
    ["at above 1", (_r, _m, k) => void ((k[0] as Record<string, unknown>).at = 1.2), "bad_shape", "$.morph.keys[0].at"],
    ["two keys at one stop", (_r, _m, k) => void ((k[0] as Record<string, unknown>).at = 1), "bad_shape", "$.morph.keys[1].at"],
    ["a box off the canvas", (_r, _m, k) => void ((k[3] as Record<string, unknown>).bbox = [200, 150, 60, 40]), "bbox_out_of_bounds", "$.morph.keys[3].bbox"],
    ["a negative box", (_r, _m, k) => void ((k[3] as Record<string, unknown>).bbox = [-1, 150, 60, 40]), "bad_shape", "$.morph.keys[3].bbox"],
    ["a fractional cell", (_r, _m, k) => void ((k[3] as Record<string, unknown>).cell = [0.5, 0, 10, 10]), "bad_shape", "$.morph.keys[3].cell"],
    ["flowCell without flowMax", (_r, _m, k) => void delete (k[0] as Record<string, unknown>).flowMax, "bad_shape", "$.morph.keys[0].flowMax"],
    ["flowMax without flowCell", (_r, _m, k) => void delete (k[0] as Record<string, unknown>).flowCell, "bad_shape", "$.morph.keys[0].flowCell"],
    ["flowMax 0", (_r, _m, k) => void ((k[0] as Record<string, unknown>).flowMax = 0), "bad_shape", "$.morph.keys[0].flowMax"],
    ["flowCell without flow", (_r, m) => void delete m.flow, "bad_shape", "$.morph.flow"],
    ["flow when no key moves", (_r, m) => void (m.keys = [key({})]), "bad_shape", "$.morph.flow"],
    ["no keys", (_r, m) => void (m.keys = []), "bad_shape", "$.morph.keys"],
    ["41 keys", (_r, m) => void (m.keys = Array.from({ length: 41 }, (_, i) => key({ id: `k${i}`, track: "joy", at: (i + 1) / 41 }))), "bad_shape", "$.morph.keys"],
    ["five stops", (_r, _m, k) => void k.push(key({ id: "b1", track: "blink", at: 0.2 }), key({ id: "b2", track: "blink", at: 0.3 }), key({ id: "b3", track: "blink", at: 0.4 })), "bad_shape", "$.morph.keys[9].track"],
    ["one eye", (_r, m) => void (m.eyes = [[1, 2]]), "bad_shape", "$.morph.eyes"],
    ["an eye off the canvas", (_r, m) => void (m.eyes = [[1, 2], [300, 2]]), "bbox_out_of_bounds", "$.morph.eyes[1]"],
    ["an absolute atlas path", (_r, m) => void (m.atlas = "/atlas.webp"), "bad_shape", "$.morph.atlas"],
    ["a sway past 5 % of the width", (_r, m) => void (m.sway = { map: "s.png", amp: 13 }), "bad_shape", "$.morph.sway.amp"],
    ["a sway without a map", (_r, m) => void (m.sway = { amp: 3 }), "bad_shape", "$.morph.sway.map"],
  ])("%s", (_label, edit, code, path) => {
    const result = validateRig(edited(edit));
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.errors;
    expect(errors).toContainEqual(expect.objectContaining({ code, path }));
    // A shape fault starts with its JSON path; a semantic one names the morph key or eye.
    for (const e of errors.filter((x) => x.path === path)) expect(e.message).toMatch(e.code === "bad_shape" ? path : /^morph (key|eye)/);
  });
});

describe("serializeRig: morph", () => {
  it("round-trips through parseRigJson unchanged, keys in contract order", () => {
    const rig = morphRig();
    const text = serializeRig(rig);
    const back = parseRigJson(text);
    expect(back.ok && back.value).toEqual(rig);
    expect(back.ok && serializeRig(back.value)).toBe(text);
    const wire = JSON.parse(text) as { morph: Record<string, unknown> & { keys: Record<string, unknown>[] } };
    expect(Object.keys(wire).at(-1)).toBe("morph");
    expect(Object.keys(wire.morph)).toEqual(["layer", "atlas", "flow", "keys", "eyes", "sway"]);
    expect(Object.keys(wire.morph.keys[0] ?? {})).toEqual(["id", "track", "at", "bbox", "cell", "flowCell", "flowMax"]);
    expect(Object.keys(wire.morph.keys[1] ?? {})).toEqual(["id", "track", "bbox", "cell"]);
  });

  it("drops fields outside the contract and writes no morph key for a rig without one", () => {
    const rig = morphRig();
    const noisy = { ...rig, morph: { ...rig.morph, extra: 1, keys: MORPH_KEYS.map((k) => ({ ...k, note: "x", at: k.at })) } } as Rig;
    expect(serializeRig(noisy)).toBe(serializeRig(rig));
    const plain: Rig = { ...rig };
    delete plain.morph;
    expect(serializeRig(plain)).not.toContain("morph");
    const back = parseRigJson(serializeRig(plain));
    expect(back.ok && "morph" in back.value).toBe(false);
  });
});
