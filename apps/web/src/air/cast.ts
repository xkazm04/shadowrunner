// Who is speaking on the stage, and what they say (replay plane): each seeded character has its
// own recorded show (`assets/replay/shows/<slug>-night.json`, fictional) and its own voice. The
// on-air record picks the show (by library id or cast slug), the persona (name, bible built from
// its brief or preset notes and its own example lines, the voice saved with the record) and the
// name its replies are posted under in chat. Malakor keeps his written bible. C4: a character with
// no recorded show (one the user forged) goes on air as itself when its record carries a character
// sheet - its own name, hook, lines and chosen voice, and a scripted show of its own lines
// (sheetShow.ts); without a sheet (a record kept before C4) it stands in with Malakor's, as before.
import { castBible, castSlug, castVoice, parseShow, showOf, type Persona, type ShowBank, type ShowScript, type VoiceId } from "@sr/engine";
import type { CharacterSheet } from "@sr/pack";
import { castBriefNote } from "../creator/gallery/castBriefs";
import { noteFor, presetNotes } from "../creator/gallery/notes";
import { MALAKOR_NAME, MALAKOR_PERSONA, malakorShow } from "./malakor";
import { sheetBible, sheetShow } from "./sheetShow";
import recordedJson from "../../../../assets/replay/shows/recorded.json";

/** Every committed `<slug>-night.json`, validated once. */
const SHOW_FILES = import.meta.glob<unknown>("../../../../assets/replay/shows/*-night.json", { eager: true, import: "default" });

let shows: readonly ShowScript[] | undefined;

/** The recorded shows of the whole cast, Malakor's included. A file that does not validate is a build error. */
export function castShows(): readonly ShowScript[] {
  if (shows !== undefined) return shows;
  shows = Object.entries(SHOW_FILES).map(([path, json]) => {
    const show = parseShow(json);
    if (show === undefined) throw new Error(`${path} does not validate`);
    return show;
  });
  return shows;
}

let bank: ShowBank | undefined;

/** The cast's shows and the WAVs that really exist (`recorded.json`): where a sheet line may find a recording. */
export function castBank(): ShowBank {
  bank ??= { shows: castShows(), recorded: new Set<string>(recordedJson.recorded) };
  return bank;
}

/** What the stage runs on: the show, the persona sent with every request, and the chat name. */
export interface Cast {
  show: ShowScript;
  persona: Persona;
  self: string;
  /** C4: the show is the character sheet's script (on replay it runs in the browser, labelled SCRIPTED). */
  scripted?: true;
}

/** The on-air record the cast is chosen by. */
export interface Speaker {
  id: string;
  name: string;
  voice: VoiceId;
  /** The record's character sheet (C4), when it has one. */
  sheet?: CharacterSheet;
}

/** "Auntie Asp, Keeper of the Stone Stacks" posts as "Auntie Asp". */
export function chatName(name: string): string {
  return name.split(",")[0]?.trim() || name;
}

function hookOf(slug: string, name: string): string {
  return castBriefNote(slug)?.hook ?? noteFor(presetNotes(), name).hook ?? "";
}

/** Malakor when nobody is on air, else the speaker's own show, persona and voice. */
export function castFor(speaker: Speaker | undefined, bank: readonly ShowScript[] = castShows()): Cast {
  const house: Cast = { show: malakorShow(), persona: MALAKOR_PERSONA, self: MALAKOR_NAME };
  if (speaker === undefined) return house;
  const slug = castSlug(speaker.id);
  if (slug === MALAKOR_PERSONA.characterId) return { ...house, persona: { ...MALAKOR_PERSONA, voice: speaker.voice } };
  const show = castVoice(slug) === undefined ? undefined : showOf(bank, slug);
  if (show === undefined) return speaker.sheet === undefined ? house : sheetCast(speaker, speaker.sheet);
  const bible = castBible(speaker.name, hookOf(slug, speaker.name), show);
  return { show, persona: { characterId: show.characterId, name: speaker.name, bible, voice: speaker.voice }, self: chatName(speaker.name) };
}

/** A forged character on air as itself: its sheet's persona and script, its chosen voice, its chat name. */
function sheetCast(speaker: Speaker, sheet: CharacterSheet): Cast {
  const persona: Persona = { characterId: speaker.id, name: speaker.name, bible: sheetBible(speaker.name, sheet), voice: speaker.voice };
  return { show: sheetShow(speaker.id, sheet), persona, self: chatName(speaker.name), scripted: true };
}
