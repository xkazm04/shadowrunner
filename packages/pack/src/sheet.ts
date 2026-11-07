// The character sheet (C4, "a forged co-host goes on air as itself"): who a forged character is on
// air, taken from the brief the streamer approved - its archetype, its persona hook and up to three
// example lines. The library record keeps it and a pack carries it (pack.json `sheet`, optional),
// so this package owns the wire shape and the one reader both use. Pure; never JSON.parses.
// Optional JSON fields are omitted, never null: a record or pack without a sheet has no `sheet` key.

/** Who the character is on air. `lines` may be empty (a brief without example lines). */
export interface CharacterSheet {
  archetype: string;
  hook: string;
  lines: string[];
}

/** Length caps in characters after trimming; the same caps as the brief's fields (@sr/forge BRIEF_LIMITS). */
export const SHEET_LIMITS = { archetype: 120, hook: 400, line: 160, lines: 3 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" || t.length > max ? undefined : t;
};

/**
 * A stored or packed sheet, trimmed, or undefined when any field breaks a rule: archetype and hook
 * non-empty within SHEET_LIMITS, `lines` an array of at most 3 non-empty lines of at most 160
 * characters. A sheet that does not read is dropped by its callers, never repaired in part.
 */
export function readSheet(value: unknown): CharacterSheet | undefined {
  if (!isRecord(value)) return undefined;
  const fields = value;
  const archetype = text(fields.archetype, SHEET_LIMITS.archetype);
  const hook = text(fields.hook, SHEET_LIMITS.hook);
  const raw = fields.lines;
  if (archetype === undefined || hook === undefined || !Array.isArray(raw) || raw.length > SHEET_LIMITS.lines) return undefined;
  const lines = raw.map((line) => text(line, SHEET_LIMITS.line));
  return lines.every((line): line is string => line !== undefined) ? { archetype, hook, lines } : undefined;
}
