// Replay voice for every seeded character: the stage picks the on-air character's own recorded show,
// persona and voice (cast.ts), and the library seeds each cast member in its own voice.
import { castVoice, CAST_VOICES, type VoiceId } from "@sr/engine";
import { defaultLook } from "@sr/rig";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openLibrary, type CharacterRecord } from "../creator/library/libraryStore";
import { seedCast } from "../creator/library/seed";
import { testRig } from "../creator/testFixtures";
import { castFor, castShows, chatName } from "./cast";
import { MALAKOR_NAME, MALAKOR_PERSONA, malakorShow } from "./malakor";

const NAMES: Record<string, string> = {
  malakor: "Arch-Lich Malakor",
  "auntie-asp": "Auntie Asp, Keeper of the Stone Stacks",
  "lot-ninety": "Lot Ninety, the Auctioneer",
  reveille: "Reveille, the Alarm of the Ninth",
  "saint-cardia": "Saint Cardia of the Glass Heart",
  "sir-vacant": "Sir Vacant",
  "the-redactor": "The Redactor",
  "the-tallyman": "The Tallyman",
  "vicar-of-the-lure": "Vicar of the Lure",
  "announcer-of-dead-air": "Announcer of Dead Air",
  "lantern-warden": "The Lantern Warden",
  "moth-widow": "The Moth Widow",
  "sister-vesper": "Sister Vesper",
  understudy: "The Understudy",
};

describe("castFor", () => {
  it("is Malakor with his show, persona and name when nobody is on air", () => {
    expect(castFor(undefined)).toEqual({ show: malakorShow(), persona: MALAKOR_PERSONA, self: MALAKOR_NAME });
  });

  it("bundles a recorded show for every cast member", () => {
    expect(castShows().map((s) => s.characterId).sort()).toEqual(Object.keys(CAST_VOICES).sort());
  });

  it("gives each seeded character its own show, name, bible and the voice saved with it", () => {
    for (const [slug, name] of Object.entries(NAMES)) {
      for (const id of slug === "malakor" ? [slug] : [`replay-${slug}`, slug]) {
        const voice = castVoice(slug) ?? "crypt";
        const cast = castFor({ id, name, voice });
        expect(cast.show.characterId).toBe(slug);
        expect(cast.persona.characterId).toBe(slug);
        expect(cast.persona.voice).toBe(voice);
        if (slug === "malakor") {
          expect(cast.persona.bible).toBe(MALAKOR_PERSONA.bible);
          expect(cast.self).toBe(MALAKOR_NAME);
          continue;
        }
        expect(cast.persona.name).toBe(name);
        expect(cast.self).toBe(chatName(name));
        expect(cast.persona.bible).toContain(name);
        expect(cast.persona.bible).toContain(cast.show.beats[0]?.reply.line);
        expect(cast.persona.bible.length).toBeGreaterThan(name.length + 100);
        expect(cast.show.fictional).toBe(true);
      }
    }
  });

  it("sends the voice the user saved, not the cast default", () => {
    const voice: VoiceId = "choir";
    expect(castFor({ id: "malakor", name: "Arch-Lich Malakor", voice }).persona.voice).toBe(voice);
    expect(castFor({ id: "replay-reveille", name: NAMES.reveille ?? "", voice }).persona.voice).toBe(voice);
  });

  it("keeps Malakor standing in for a character with no recorded show", () => {
    expect(castFor({ id: "forged-1", name: "Ghost", voice: "velvet" })).toEqual(castFor(undefined));
  });

  it("C4: a forged character with a sheet goes on air as itself: own name, hook, lines, chosen voice, chat name", () => {
    const sheet = { archetype: "Drowned diver", hook: "Hums shanties between lines.", lines: ["Forty fathoms of chat.", "Bubbles mean I laugh."] };
    const cast = castFor({ id: "forged-1", name: "Brine, of the Forty Fathoms", voice: "velvet", sheet });
    expect(cast.scripted).toBe(true);
    expect(cast.self).toBe(chatName("Brine, of the Forty Fathoms"));
    expect(cast.self).toBe("Brine");
    expect(cast.persona.characterId).toBe("forged-1");
    expect(cast.persona.name).toBe("Brine, of the Forty Fathoms");
    expect(cast.persona.voice).toBe("velvet");
    expect(cast.persona.bible).not.toBe(MALAKOR_PERSONA.bible);
    expect(cast.persona.bible).not.toContain("Malakor");
    for (const text of ["Brine, of the Forty Fathoms", sheet.hook, sheet.archetype, ...sheet.lines]) expect(cast.persona.bible).toContain(text);
    expect(cast.show.characterId).toBe("forged-1");
    expect(cast.show.beats.map((b) => b.reply.line)).toEqual(sheet.lines);
  });

  it("C4: a cast character with a recorded show keeps its show even with a sheet", () => {
    const sheet = { archetype: "A", hook: "H", lines: ["L"] };
    const withSheet = castFor({ id: "replay-reveille", name: NAMES.reveille ?? "", voice: "rasp", sheet });
    expect(withSheet).toEqual(castFor({ id: "replay-reveille", name: NAMES.reveille ?? "", voice: "rasp" }));
    expect(castFor({ id: "malakor", name: "Arch-Lich Malakor", voice: "clerk", sheet }).persona.bible).toBe(MALAKOR_PERSONA.bible);
  });

  it("posts a long name as its first clause", () => {
    expect(chatName("Auntie Asp, Keeper of the Stone Stacks")).toBe("Auntie Asp");
    expect(chatName("Sir Vacant")).toBe("Sir Vacant");
    expect(chatName(",")).toBe(",");
  });
});

describe("seedCast voices", () => {
  const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const record = (id: string): CharacterRecord => {
    const rig = testRig(id, id);
    return { id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, png()])), look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
  };

  it("seeds each cast member in its own voice and leaves an unknown character's voice alone", async () => {
    const store = await openLibrary(() => new IDBFactory());
    const ids = ["replay-lot-ninety", "replay-saint-cardia", "replay-the-tallyman", "forged-9"];
    await seedCast(store, ids.map((id) => ({ id, load: async () => record(id) })));
    const voices = Object.fromEntries((await store.list()).flatMap((e) => (e.kind === "ok" ? [[e.record.id, e.record.voice]] : [])));
    expect(voices).toEqual({ "replay-lot-ninety": "rasp", "replay-saint-cardia": "choir", "replay-the-tallyman": "clerk", "forged-9": "crypt" });
  });
});
