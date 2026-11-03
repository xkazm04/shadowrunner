// cast-forge golden (design.md "Testing strategy"): each committed cast rig loads, poses at t = 0 and
// t = 1.7 s and passes validateRig; every named part of its parts.json is its own layer; its float
// and pulse layers move. Built by scripts/cast-forge.mjs; no network.
import { motionAt, poseLayers, validateRig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import cardiaJob from "../../../assets/replay/forge/saint-cardia/job.json";
import cardiaParts from "../../../assets/characters/cast/saint-cardia/parts.json";
import redactorJob from "../../../assets/replay/forge/the-redactor/job.json";
import redactorParts from "../../../assets/characters/cast/the-redactor/parts.json";
import reveilleJob from "../../../assets/replay/forge/reveille/job.json";
import reveilleParts from "../../../assets/characters/cast/reveille/parts.json";
import vicarJob from "../../../assets/replay/forge/vicar-of-the-lure/job.json";
import vicarParts from "../../../assets/characters/cast/vicar-of-the-lure/parts.json";
import { parseParts } from "./parts.js";

const CAST = [
  { slug: "saint-cardia", job: cardiaJob as unknown, parts: cardiaParts as unknown },
  { slug: "the-redactor", job: redactorJob as unknown, parts: redactorParts as unknown },
  { slug: "reveille", job: reveilleJob as unknown, parts: reveilleParts as unknown },
  { slug: "vicar-of-the-lure", job: vicarJob as unknown, parts: vicarParts as unknown },
];

describe.each(CAST)("cast rig $slug", ({ job, parts }) => {
  const rig = validateRig((job as { rig: unknown }).rig);
  const parsed = parseParts(parts);

  it("validates, is fictional, and has one layer per named part", () => {
    expect(rig.ok).toBe(true);
    expect(parsed.ok).toBe(true);
    if (!rig.ok || !parsed.ok) return;
    expect((job as { fictional?: unknown }).fictional).toBe(true);
    const names = rig.value.layers.map((l) => l.name);
    for (const part of parsed.value.named ?? []) expect(names).toContain(part.name);
  });

  it("poses at t = 0 and t = 1.7 s, and its float and pulse layers move between them", () => {
    if (!rig.ok || !parsed.ok) throw new Error("invalid fixture");
    const look = { palette: rig.value.palette, hidden: [], emotion: "neutral" as const };
    const at = (t: number) => poseLayers(rig.value, look, { t, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 });
    const [a, b] = [at(0), at(1.7)];
    expect(a).toHaveLength(rig.value.layers.length);
    for (const part of parsed.value.named ?? []) {
      if (part.role !== "float" && part.role !== "pulse") continue;
      const layer = rig.value.layers.find((l) => l.name === part.name);
      expect(layer?.motion).toBeDefined();
      const pa = a.find((p) => p.name === part.name);
      const pb = b.find((p) => p.name === part.name);
      const moved = pa !== undefined && pb !== undefined && (Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) > 0.1 || Math.abs(pa.tint - pb.tint) > 0.01);
      expect(moved, `${part.name} moves`).toBe(true);
      expect(motionAt(layer?.motion, 1.7, true).dx).toBe(0);
    }
  });
});
