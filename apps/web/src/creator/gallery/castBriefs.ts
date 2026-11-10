// The cast-forge characters' own words (cast-forge requirement 5.2): each of the eight has a
// committed brief (`assets/characters/cast/<slug>/brief.json`) whose persona hook the gallery and the
// CH 4 listings show, and whose style names what the character shows off. Only those two top-level
// fields are imported (Vite's JSON named exports), so the parts plans and world notes stay out of
// the bundle (the style object carries its portrait prompt, about 2 KB each). A recorded job whose
// folder has a brief here is a cast-forge character.
//
// Decision (first-visit cost, task 12): the cast-forge eight are listed but adopted on demand (a
// gallery press or a deep link), never seeded into every visitor's library in the background: eight
// more rigs would more than double the art a first visit downloads (their layer images are 13.8 MB,
// the five presets' 12.8 MB).
//
// perfection-pass task 13: the five presets now have a brief too, written after their recording
// (`"authored": "after-recording"`), only so the replay brief matcher can choose them. They stay
// presets here (seeded, noted from PROMPTS.md): a cast-forge character is a brief whose folder also
// holds the named-parts recording (`parts.json`, of which only `version` is imported); the five's
// folders hold only the brief. (Importing `authored` itself would fail the build on the eight,
// which omit it.)

const HOOKS = import.meta.glob<unknown>("../../../../../assets/characters/cast/*/brief.json", { eager: true, import: "persona_hook" });
const STYLES = import.meta.glob<unknown>("../../../../../assets/characters/cast/*/brief.json", { eager: true, import: "style" });
const RECORDED = new Set(
  Object.keys(import.meta.glob<unknown>("../../../../../assets/characters/cast/*/parts.json", { eager: true, import: "version" })).map((path) => path.split("/").at(-2) ?? ""),
);

export interface CastBriefNote {
  /** The brief's persona hook. */
  hook: string;
  /** The brief's art style, e.g. "Leaded stained glass". */
  style: string;
}

const slugOf = (path: string): string => path.split("/").at(-2) ?? "";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readNotes(): ReadonlyMap<string, CastBriefNote> {
  const out = new Map<string, CastBriefNote>();
  for (const [path, hook] of Object.entries(HOOKS)) {
    const style = STYLES[path];
    if (!RECORDED.has(slugOf(path)) || typeof hook !== "string" || hook.trim() === "" || !isRecord(style) || typeof style.name !== "string") continue;
    out.set(slugOf(path), { hook: hook.trim(), style: style.name.trim() });
  }
  return out;
}

const NOTES = readNotes();

/** The cast-forge brief's hook and style for a recorded job's slug, when it is one of the cast. */
export function castBriefNote(slug: string): CastBriefNote | undefined {
  return NOTES.get(slug);
}

/** The slugs of every committed cast-forge brief, sorted. */
export function castBriefSlugs(): string[] {
  return [...NOTES.keys()].sort();
}
