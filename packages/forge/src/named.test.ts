// cast-forge task 2.1: parseParts v2 (named parts) and the role rules in named.ts.
import { describe, expect, it } from "vitest";
import { DEFAULT_FLOAT, carrierOf, cutOrderNamed, followOf, isKeyed, motionOf, scaleMotion } from "./named.js";
import { MAX_NAMED_PARTS, ROLE_KIND, parseParts } from "./parts.js";
import type { NamedPart } from "./types.js";

const box: [number, number, number, number] = [100, 100, 300, 300];
const poly: [number, number][] = [
  [100, 100],
  [100, 300],
  [300, 300],
];
const entry = (name: string, role: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, role, box_2d: box, poly, ...extra });
const file = (...parts: unknown[]): unknown => ({ version: 2, parts });
const named = (name: string, role: NamedPart["role"], extra: Partial<NamedPart> = {}): NamedPart => ({ name, role, box_2d: box, poly, ...extra });

function errorsOf(json: unknown): { path: string; message: string }[] {
  const result = parseParts(json);
  if (result.ok) throw new Error("expected errors");
  return result.errors.map(({ path, message }) => ({ path, message }));
}

describe("parseParts v2", () => {
  it("parses named parts with follow, motion and key, and gives the v1 view", () => {
    const json = file(
      entry("face", "head"),
      entry("robe", "torso"),
      entry("cage", "accessory", { follow: "robe" }),
      entry("heart", "pulse", { follow: "cage", motion: { pulse: { amp: 0.6, freq: 1.1 } }, key: false, extra: "dropped" }),
      entry("spire_1", "float", { motion: { float: { amp: [1, 3], freq: 0.3, rot_deg: 2, phase: 0.25 } } }),
    );
    const result = parseParts(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.named?.map((p) => p.name)).toEqual(["face", "robe", "cage", "heart", "spire_1"]);
    expect(result.value.named?.[3]).toEqual({ name: "heart", role: "pulse", box_2d: box, poly, follow: "cage", motion: { pulse: { amp: 0.6, freq: 1.1 } }, key: false });
    expect(result.value.parts.map((p) => p.name)).toEqual(["head", "torso", "accessory"]);
    expect(result.value.warnings).toEqual([]);
  });

  it("rejects bad names, roles, keys and reserved names at their paths", () => {
    const paths = errorsOf(file(entry("face", "head"), entry("Bad-Name", "jaw"), entry("background", "torso"), entry("x", "wing"), entry("y", "jaw", { key: "yes" }))).map((e) => e.path);
    expect(paths).toEqual(["$.parts[1].name", "$.parts[2].name", "$.parts[3].role", "$.parts[4].key"]);
  });

  it("rejects unknown follows, self follows and cycles", () => {
    expect(errorsOf(file(entry("face", "head"), entry("a", "jaw", { follow: "nobody" })))).toEqual([{ path: "$.parts[1].follow", message: "must name another part of this file" }]);
    expect(errorsOf(file(entry("face", "head"), entry("a", "jaw", { follow: "a" })))[0]?.path).toBe("$.parts[1].follow");
    const cycle = errorsOf(file(entry("face", "head"), entry("a", "float", { follow: "b" }), entry("b", "float", { follow: "c" }), entry("c", "float", { follow: "a" })));
    expect(cycle.map((e) => e.message)).toEqual(["makes a follow cycle", "makes a follow cycle", "makes a follow cycle"]);
    // Through a default: the head follows the monocle, which follows the head by default.
    expect(errorsOf(file(entry("face", "head", { follow: "glass" }), entry("glass", "monocle")))).toEqual([{ path: "$.parts[0].follow", message: "makes a follow cycle" }]);
  });

  it("rejects motion out of range without echoing the value", () => {
    const errors = errorsOf(file(entry("face", "head"), entry("s", "float", { motion: { float: { amp: [60, 1], freq: 3 } } })));
    expect(errors.map((e) => e.path)).toEqual(["$.parts[1].motion.float.amp[0]", "$.parts[1].motion.float.freq"]);
    expect(errors.some((e) => e.message.includes("60"))).toBe(false);
  });

  it("requires a head role, version 2 and a non-empty list", () => {
    expect(errorsOf(file(entry("robe", "torso")))[0]?.message).toBe("has no part with role head");
    expect(errorsOf({ version: 3, parts: [] })[0]?.path).toBe("$.version");
    expect(errorsOf({ version: 2, parts: [] })[0]?.path).toBe("$.parts");
  });

  it("keeps the first of a repeated name and the first MAX_NAMED_PARTS parts, with warnings", () => {
    const many = Array.from({ length: MAX_NAMED_PARTS + 2 }, (_, i) => entry(`p${i}`, "float"));
    const result = parseParts(file(entry("face", "head"), entry("face", "jaw"), ...many));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.named).toHaveLength(MAX_NAMED_PARTS - 1);
    expect(result.value.named?.[0]?.role).toBe("head");
    expect(result.value.warnings.map((w) => w.path)).toEqual(["$.parts", "$.parts[1].name"]);
  });
});

describe("named part rules", () => {
  it("ROLE_KIND maps the extra roles", () => {
    expect([ROLE_KIND.eye, ROLE_KIND.float, ROLE_KIND.pulse, ROLE_KIND.torso, ROLE_KIND.hair]).toEqual(["eye", "accessory", "accessory", "body", "crown"]);
  });

  it("cuts front to back by role, file order within a role group", () => {
    const parts = [named("robe", "torso"), named("face", "head"), named("r", "eye_r"), named("l", "eye_l"), named("c", "crown"), named("h", "pulse"), named("s2", "float"), named("s1", "float"), named("j", "jaw")];
    expect(cutOrderNamed(parts).map((p) => p.name)).toEqual(["s2", "s1", "h", "r", "l", "c", "j", "face", "robe"]);
  });

  it("follows the head by default and carries a part by the plate part its chain hangs on", () => {
    const parts = [named("face", "head"), named("robe", "torso"), named("cage", "accessory", { follow: "robe" }), named("heart", "pulse", { follow: "cage" }), named("crown", "crown"), named("tip", "float", { follow: "crown" })];
    expect(parts.map((p) => followOf(p, "face"))).toEqual([undefined, undefined, "robe", "cage", "face", "crown"]);
    expect(parts.map((p) => carrierOf(p, parts))).toEqual(["face", "robe", "robe", "robe", "face", "face"]);
  });

  it("keys crown, hair, accessory and float by default, unless the part says", () => {
    expect([named("a", "crown"), named("b", "float"), named("c", "pulse"), named("d", "head"), named("e", "float", { key: false })].map(isKeyed)).toEqual([true, true, false, false, false]);
  });

  it("gives float and pulse parts default motion with phases that differ by name", () => {
    const a = motionOf(named("spire_a", "float"));
    const b = motionOf(named("spire_b", "float"));
    expect(a?.float?.amp).toEqual(DEFAULT_FLOAT.amp);
    expect(a?.float?.phase).not.toBe(b?.float?.phase);
    expect(motionOf(named("heart", "pulse"))?.pulse?.amp).toBeGreaterThan(0);
    expect(motionOf(named("jaw", "jaw"))).toBeUndefined();
    expect(motionOf(named("x", "float", { motion: { float: { amp: [1, 1], freq: 1, phase: 0.5 } } }))?.float?.phase).toBe(0.5);
    expect(scaleMotion({ float: { amp: [2, 4], freq: 1 } }, 512, 256, 1024).float?.amp).toEqual([1, 1]);
  });
});
