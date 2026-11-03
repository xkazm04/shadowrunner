// The preset notes reader (creator task 9, landing task 12): the committed PROMPTS.md gives every
// recorded preset its "Teaches", "Persona hook" and roster signature, matched by the prompt the job
// recorded; a generated notes file reads back what was written (property).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadReplayJobs } from "../replayJobs";
import { castOf, loadCast, loadGallery, memberFor } from "./entries";
import { noteFor, parsePresetNotes, presetNotes, type PresetNote } from "./notes";

/** Cast-forge members recorded so far (cast-forge task 2); their notes come from brief.json in task 12, not PROMPTS.md. */
const CAST_FORGE = ["saint-cardia", "the-redactor", "vicar-of-the-lure", "reveille", "the-tallyman", "sir-vacant"];

describe("the committed preset notes", () => {
  it("lists five presets, each with what it teaches, a persona hook, an accent and its prompt", () => {
    const { presets, roster } = presetNotes();
    expect(presets.map((p) => p.heading)).toEqual([
      "The Lantern Warden",
      "Sister Vesper of the Drowned Choir",
      "The Understudy",
      "The Moth Widow",
      "The Announcer of Dead Air",
    ]);
    for (const p of presets) {
      expect(p.teaches).toMatch(/\S/);
      expect(p.teaches).not.toContain("`");
      expect(p.hook).toMatch(/\S/);
      expect(p.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.prompt?.length).toBeGreaterThan(100);
    }
    expect(roster.map((r) => r.name)).toContain("Arch-Lich Malakor");
    expect(roster).toHaveLength(6);
  });

  it("finds the notes of every recorded preset job by its prompt, and Malakor's signature by name", async () => {
    const jobs = (await loadReplayJobs()).filter((j) => j.slug !== "malakor" && !CAST_FORGE.includes(j.slug));
    expect(jobs).toHaveLength(5);
    for (const job of jobs) {
      const note = noteFor(presetNotes(), job.name, job.prompt);
      expect(note.teaches, job.slug).toBeDefined();
      expect(note.hook, job.slug).toBeDefined();
      expect(note.showsOff, job.slug).toBeDefined();
    }
    expect(noteFor(presetNotes(), "The Lantern Warden").showsOff).toBe("hat, lit jaw");
    expect(noteFor(presetNotes(), "Arch-Lich Malakor")).toEqual({ showsOff: "crown shards, monocle" });
    expect(noteFor(presetNotes(), "Nobody We Know")).toEqual({});
  });
});

describe("the cast", () => {
  it("is Malakor and every recorded preset once: the gallery lists every job, the cast drops the re-forged house character", async () => {
    const gallery = await loadGallery();
    const jobs = await loadReplayJobs();
    expect(gallery).toHaveLength(jobs.length + 1);
    const cast = await loadCast();
    expect(cast.map((m) => m.slug)).toEqual(["malakor", "announcer-of-dead-air", "lantern-warden", "moth-widow", "the-redactor", "reveille", "saint-cardia", "sir-vacant", "sister-vesper", "the-tallyman", "understudy", "vicar-of-the-lure"]);
    expect(cast[0]).toMatchObject({ id: "malakor", origin: "hand-rigged", showsOff: "crown shards, monocle" });
    for (const m of cast.slice(1)) {
      expect(m.id).toBe(`replay-${m.slug}`);
      if (!CAST_FORGE.includes(m.slug)) expect(m.hook).toBeDefined();
      expect(m.portraitUrl).toMatch(/thumbs\/.+\.webp/);
    }
    expect(castOf(gallery.filter((e) => e.origin === "forged")).map((e) => e.slug)).toContain("malakor");
  });

  it("finds a deep link's member by slug, then by rig id", async () => {
    const cast = await loadCast();
    expect(memberFor(cast, "lantern-warden")?.id).toBe("replay-lantern-warden");
    expect(memberFor(cast, "replay-understudy")?.slug).toBe("understudy");
    expect(memberFor(cast, "malakor")?.origin).toBe("hand-rigged");
    expect(memberFor(cast, "nobody")).toBeUndefined();
  });
});

// Words without Markdown marks or line breaks, as a person would write them.
const words = fc
  .array(fc.constantFrom("gourd", "lantern", "hat", "jaw", "cold", "river", "moth", "lamp", "the", "of", "a"), { minLength: 1, maxLength: 12 })
  .map((w) => w.join(" "));
const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);
const preset = fc.record(
  { heading: words, teaches: words, hook: words, accent: hex, prompt: fc.array(words, { minLength: 1, maxLength: 4 }) },
  { requiredKeys: ["heading"] },
);

function render(presets: readonly (Omit<PresetNote, "prompt"> & { prompt?: string[] })[]): string {
  const out = ["# Preset characters", "", "Intro text. **Teaches:** not a field here.", ""];
  presets.forEach((p, i) => {
    out.push(`## ${i + 1}. ${p.heading}`);
    if (p.teaches !== undefined) out.push(`- **Teaches:** \`${p.teaches.split(" ")[0]}\` ${p.teaches.split(" ").slice(1).join(" ")}`.trimEnd());
    if (p.accent !== undefined) out.push(`- **Accent:** colour \`${p.accent}\`.`);
    if (p.hook !== undefined) out.push(`- **Persona hook:** ${p.hook}`);
    if (p.prompt !== undefined) out.push("", "**Character:**", ...p.prompt.map((line) => `> ${line}`));
    out.push("");
  });
  out.push("## Roster check", "| Preset | Signature layer |", "|---|---|", ...presets.map((p) => `| ${p.heading} | ${p.hook ?? "none"} |`));
  return out.join("\n");
}

describe("parsePresetNotes (property)", () => {
  it("reads back every field that was written, and nothing that was not", () => {
    fc.assert(
      fc.property(fc.array(preset, { maxLength: 6 }), (presets) => {
        const parsed = parsePresetNotes(render(presets));
        expect(parsed.presets).toHaveLength(presets.length);
        presets.forEach((p, i) => {
          const got = parsed.presets[i];
          expect(got?.heading).toBe(p.heading);
          expect(got?.teaches).toBe(p.teaches);
          expect(got?.hook).toBe(p.hook);
          expect(got?.accent).toBe(p.accent);
          expect(got?.prompt).toBe(p.prompt?.join(" "));
          expect(parsed.roster[i]).toEqual({ name: p.heading, signature: p.hook ?? "none" });
        });
      }),
    );
  });
});
