// Round 4 (F4): every recorded character's parts agree with the back-fill's CAST table (art => the art
// keeps its mouth and `drawnMouth` is true, otherwise a lip). A v1 file's part is named for its role
// (`asNamed`). The Announcer's skull grin and the Lantern Warden's carved grin carry `mouth: "art"`
// (not a cavity value: gap/fill would repaint what the cut puts in their heads).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ART_MOUTH, asNamed, drawnMouth, parseParts } from "@sr/forge";
import { describe, expect, it } from "vitest";

describe("drawnMouth on the recorded cast", () => {
  const ROOT = new URL("../../", import.meta.url);
  const recorded = (dir: string, slug: string) => {
    const json = JSON.parse(readFileSync(new URL(`assets/characters/${dir}/${slug}/parts.json`, ROOT), "utf8")) as unknown;
    const list = (Array.isArray(json) ? json : (json as { parts: unknown[] }).parts) as { name: string; role?: string; cavity?: string; mouth?: string }[];
    return list.map((p) => ({ ...p, role: p.role ?? p.name }));
  };
  // Only folders with a recording: since perfection-pass task 13 the five presets also have a cast
  // folder holding only their after-recording brief (their parts are read under presets/).
  const slugsIn = (dir: string) =>
    readdirSync(new URL(`assets/characters/${dir}/`, ROOT), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(new URL(`assets/characters/${dir}/${d.name}/parts.json`, ROOT)))
      .map((d) => d.name);
  // The table is a literal in the script (not importable: it runs on load); `art:` marks the art-kept mouths.
  const table = readFileSync(new URL("scripts/cast/mouth-backfill.mjs", ROOT), "utf8");
  const art = new Set([...table.matchAll(/^\s*"?([a-z-]+)"?: \{ art:/gm)].map((m) => m[1] as string));

  it("reads the back-fill's art entries", () => {
    expect([...art].sort()).toEqual(["announcer-of-dead-air", "lantern-warden", "reveille", "sir-vacant", "vicar-of-the-lure"]);
  });

  it("the Announcer's skull grin and the Lantern Warden's carved grin are drawn mouths, flagged not painted differently", () => {
    for (const slug of ["announcer-of-dead-air", "lantern-warden"]) {
      const parts = recorded("presets", slug);
      expect(drawnMouth(parts)).toBe(true);
      const jaw = parts.find((p) => p.role === "jaw");
      expect(jaw?.mouth).toBe(ART_MOUTH);
      expect(jaw?.cavity).toBeUndefined(); // the cavity stays painted as recorded
    }
  });

  it.each([
    ...slugsIn("cast").map((slug) => ["cast", slug] as const),
    ...slugsIn("presets").map((slug) => ["presets", slug] as const),
  ])("%s/%s: drawnMouth is true exactly when the back-fill's table says art", (dir, slug) => {
    expect(drawnMouth(recorded(dir, slug))).toBe(art.has(slug));
  });
  it("the flag survives the live parser (parseParts -> asNamed), so a re-forge keeps their art mouths", () => {
    for (const slug of ["announcer-of-dead-air", "lantern-warden"]) {
      const parsed = parseParts(JSON.parse(readFileSync(new URL(`assets/characters/presets/${slug}/parts.json`, ROOT), "utf8")));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(drawnMouth(parsed.value.named ?? asNamed(parsed.value.parts))).toBe(true);
    }
    const lips = parseParts(JSON.parse(readFileSync(new URL("assets/characters/presets/moth-widow/parts.json", ROOT), "utf8")));
    if (lips.ok) expect(drawnMouth(lips.value.named ?? asNamed(lips.value.parts))).toBe(false);
  });
});
