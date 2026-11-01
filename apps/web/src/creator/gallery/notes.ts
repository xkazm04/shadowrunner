// What each character teaches and who it is, read from the committed preset notes
// (`assets/characters/presets/PROMPTS.md`) instead of a list in code (creator task 9, landing
// task 12). The notes are Markdown written for people; this is a small, forgiving reader of the
// parts the app shows:
// - each preset section `## <n>. <Heading>` with its `- **Teaches:**`, `- **Persona hook:**` and
//   `- **Accent:**` lines and the `**Character:**` block quote (the exact prompt the job recorded);
// - the `## Roster check` table, whose "Signature layer" column names what every character
//   (Malakor too) shows off.
// A character is matched to its notes by the prompt it was forged from, then by name. Anything the
// notes do not say is left out, never invented.
import notesSource from "../../../../../assets/characters/presets/PROMPTS.md?raw";

export interface PresetNote {
  /** The section heading without its number, e.g. "Sister Vesper of the Drowned Choir". */
  heading: string;
  /** "Teaches", as plain text (code marks removed). */
  teaches?: string;
  /** "Persona hook". */
  hook?: string;
  /** The accent colour, `#rrggbb`. */
  accent?: string;
  /** The "Character" block quote joined into one line: the prompt a forge job records. */
  prompt?: string;
}

export interface RosterRow {
  name: string;
  /** "Signature layer", e.g. "hat, lit jaw". */
  signature: string;
}

export interface PresetNotes {
  presets: PresetNote[];
  roster: RosterRow[];
}

/** What the notes say about one character. */
export interface CharacterNote {
  teaches?: string;
  hook?: string;
  /** The roster's signature layer. */
  showsOff?: string;
}

const SECTION = /^##\s+\d+\.\s+(.+?)\s*$/;
const FIELD = /^-\s+\*\*([^*]+?):\*\*\s*(.*)$/;
const HEX = /#[0-9a-fA-F]{6}\b/;

const plain = (text: string): string => text.replace(/`([^`]*)`/g, "$1").replace(/\s+/g, " ").trim();

/** Reads the notes. Unknown lines are skipped; a section without fields is still listed by heading. */
export function parsePresetNotes(source: string): PresetNotes {
  const presets: PresetNote[] = [];
  const roster: RosterRow[] = [];
  let current: PresetNote | undefined;
  let inRoster = false;
  let quote: string[] | undefined;

  const closeQuote = (): void => {
    if (current !== undefined && quote !== undefined && quote.length > 0) current.prompt = quote.join(" ").replace(/\s+/g, " ").trim();
    quote = undefined;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      closeQuote();
      const section = SECTION.exec(line);
      current = section?.[1] === undefined ? undefined : { heading: section[1] };
      if (current !== undefined) presets.push(current);
      inRoster = /^##\s+roster check/i.test(line);
      continue;
    }
    if (inRoster) {
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      const [name, signature] = cells;
      if (name === undefined || signature === undefined || name === "" || /^-+$/.test(name) || name.toLowerCase() === "preset") continue;
      roster.push({ name, signature: plain(signature) });
      continue;
    }
    if (current === undefined) continue;
    if (quote !== undefined) {
      if (line.startsWith(">")) {
        quote.push(line.replace(/^>\s?/, ""));
        continue;
      }
      if (line === "" && quote.length === 0) continue;
      closeQuote();
    }
    if (/^\*\*character:\*\*/i.test(line)) {
      quote = [];
      continue;
    }
    const field = FIELD.exec(line);
    if (field?.[1] === undefined || field[2] === undefined) continue;
    const key = field[1].toLowerCase();
    if (key === "teaches") current.teaches = plain(field[2]);
    else if (key === "persona hook") current.hook = plain(field[2]);
    else if (key === "accent") {
      const hex = HEX.exec(field[2])?.[0];
      if (hex !== undefined) current.accent = hex.toLowerCase();
    }
  }
  closeQuote();
  return { presets, roster };
}

/** Lower case, single spaces, without a leading "the". */
export const normName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");

const sameOrLonger = (long: string, short: string): boolean => long === short || long.startsWith(`${short} `);

/** The notes for a character by the prompt it was forged from, then by its name. */
export function noteFor(notes: PresetNotes, name: string, prompt?: string): CharacterNote {
  const key = normName(name);
  const preset =
    (prompt === undefined ? undefined : notes.presets.find((p) => p.prompt !== undefined && p.prompt === prompt.replace(/\s+/g, " ").trim())) ??
    notes.presets.find((p) => sameOrLonger(normName(p.heading), key));
  const row =
    notes.roster.find((r) => normName(r.name) === key) ??
    (preset === undefined ? undefined : notes.roster.find((r) => sameOrLonger(normName(preset.heading), normName(r.name))));
  const out: CharacterNote = {};
  if (preset?.teaches !== undefined) out.teaches = preset.teaches;
  if (preset?.hook !== undefined) out.hook = preset.hook;
  if (row !== undefined) out.showsOff = row.signature;
  return out;
}

let committed: PresetNotes | undefined;

/** The committed notes, read once. */
export function presetNotes(): PresetNotes {
  committed ??= parsePresetNotes(notesSource);
  return committed;
}
