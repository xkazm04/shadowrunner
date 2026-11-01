// What the rite sends and how it binds the result (costume 3.2): the description rules and
// examples (kept from the former FORGE NEW sheet), the failure copy per wire code, and the Bind
// mark's choices, which are applied to the new record so the face wakes already lit and voiced.
import type { VoiceId } from "@sr/engine";
import type { ForgeErrorCode, ForgeRequest } from "@sr/forge/wire";
import type { Palette } from "@sr/rig";
import type { CharacterRecord } from "../library/libraryStore";

export const PROMPT_MIN = 10;
export const PROMPT_MAX = 500;

export interface ForgeDraft {
  prompt: string;
  image?: { base64: string; name: string; width: number; height: number };
}

export const EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Moth archivist", text: "A moth-winged archivist with violet eyes and dusty velvet robes, named Vesper" },
  { label: "Diving helmet", text: "An iron diving helmet that hums sea shanties, cold blue light behind the glass, named Brine" },
  { label: "Wax bishop", text: "A candle-wax bishop who melts when angry, a gold glow in his eyes, named Tallow" },
];

export const ARCHETYPES: readonly string[] = ["Watchman", "Lich", "Moth", "Marionette", "Drowned", "Announcer"];

/** Bind palettes: [name, eye (and rim), glow]. Look data, written to Look.palette. */
export const PALETTES: readonly (readonly [name: string, eye: string, glow: string])[] = [
  ["Candle", "#fec654", "#d8a030"],
  ["Verdigris", "#3fd6c4", "#ff7a1a"],
  ["Violet", "#bc8bfa", "#8a4fd4"],
  ["Brine", "#77b1cd", "#438bae"],
  ["Cinder", "#d04f51", "#b12d2f"],
];

export interface Bind {
  archetype?: number;
  voice?: VoiceId;
  palette?: number;
}

/** The text sent: the description, and the archetype as one more sentence when one is bound. */
export function promptOf(prompt: string, bind: Bind): string {
  const arch = bind.archetype === undefined ? undefined : ARCHETYPES[bind.archetype];
  const text = prompt.trim();
  return arch === undefined ? text : `${text.replace(/[.\s]+$/, "")}. Archetype: ${arch.toLowerCase()}.`;
}

/** The request for a draft, or why it cannot be sent yet. A picture wins over the text. */
export function requestOf(draft: ForgeDraft, bind: Bind = {}): { ok: true; request: ForgeRequest } | { ok: false; message: string } {
  if (draft.image !== undefined) return { ok: true, request: { mode: "image", imageBase64: draft.image.base64 } };
  const prompt = draft.prompt.trim();
  if (prompt.length < PROMPT_MIN) return { ok: false, message: `Describe the character in at least ${PROMPT_MIN} characters.` };
  if (prompt.length > PROMPT_MAX) return { ok: false, message: `Keep the description under ${PROMPT_MAX} characters.` };
  return { ok: true, request: { mode: "prompt", prompt: promptOf(prompt, bind) } };
}

/** The record as the Bind mark dressed it: its palette (eye and rim, glow) and its voice. */
export function bound(record: CharacterRecord, bind: Bind): CharacterRecord {
  const pal = bind.palette === undefined ? undefined : PALETTES[bind.palette];
  const palette: Palette = pal === undefined ? record.look.palette : { ...record.look.palette, eye: pal[1], rim: pal[1], glow: pal[2] };
  return { ...record, look: { ...record.look, palette }, voice: bind.voice ?? record.voice };
}

export interface FailureCopy {
  title: string;
  body: string;
}

export const FAILURE_COPY: Readonly<Record<ForgeErrorCode, FailureCopy>> = {
  quota: { title: "The forge is cold for tonight", body: "Tonight's budget for new faces is spent. The recorded characters are ready on the Forge." },
  refused_likeness: {
    title: "No real people",
    body: "That picture looks like a real person. The forge only makes invented characters: bring a drawing, or describe someone who never lived.",
  },
  refused_content: { title: "The forge will not make that", body: "Change the description and try again. Dread is fine; gore and real harm are not." },
  upstream: { title: "The image model stopped answering", body: "Nothing was lost. Your description is still here; try again." },
  bad_input: { title: "The forge could not read that", body: "Check the description or the drawing and send it again." },
};

/** Codes that are about what was described: the rite goes back to Describe for them. */
export const DESCRIBE_CODES: readonly ForgeErrorCode[] = ["refused_likeness", "refused_content", "bad_input"];
