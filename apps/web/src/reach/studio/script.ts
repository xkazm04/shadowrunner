// The studio's script (perfection-pass task 6, requirement 6.1-6.2): an ordered list of lines,
// each with an optional mood and gesture, recorded as one video. Pure: the page keeps the list in
// state and changes it only through these functions.
//
// Decisions:
// - The design's line model `{ text, emotion?, gesture? }` (absent keys omitted) plus `url` for a
//   recorded line (replay plane): the clip it plays. A typed line (live plane) has no `url`.
// - A line with no `emotion` plays in the look's own mood; one with no `gesture` fires none.
// - A recorded line starts with its recorded emotion and gesture (the show's `reply`); picking
//   another clip for the row resets them to that clip's, and the user can override either.
// - Limits, stated in the UI: MAX_SCRIPT_LINES lines and MAX_TAKE_S seconds of take (lines plus
//   pauses), so a take stays a short clip and a live script costs at most eight voice calls.
// - Each row has a stable `id` (React key, focus after a move); it is not part of the line model.
import type { Emotion, Gesture } from "@sr/rig";
import type { StudioLine } from "./lines";

export interface ScriptLine {
  text: string;
  emotion?: Emotion;
  gesture?: Gesture;
  /** The recorded clip (replay plane); absent for a typed line. */
  url?: string;
}

export interface ScriptRow extends ScriptLine {
  id: number;
}

export const MAX_SCRIPT_LINES = 8;
export const MAX_TAKE_S = 120;
/** The pause between two lines, ms: the mouth rests and the mood crossfades during it. */
export const DEFAULT_PAUSE_MS = 350;
export const MAX_PAUSE_MS = 2000;

let nextId = 1;
const newId = (): number => nextId++;

/** The row for a recorded line, with its recorded mood and gesture. */
export function recordedRow(line: StudioLine): ScriptRow {
  return {
    id: newId(),
    text: line.text,
    url: line.url,
    ...(line.emotion === undefined ? {} : { emotion: line.emotion }),
    ...(line.gesture === undefined ? {} : { gesture: line.gesture }),
  };
}

export const typedRow = (text = ""): ScriptRow => ({ id: newId(), text });

/** The row with a field set or, for `undefined`, its key removed (the absent-value convention). */
export function withField<K extends "emotion" | "gesture">(row: ScriptRow, key: K, value: ScriptRow[K] | undefined): ScriptRow {
  const next: ScriptRow = { ...row };
  if (value === undefined) Reflect.deleteProperty(next, key);
  else next[key] = value;
  return next;
}

/** The row now playing `line` (its recorded mood and gesture again), keeping the row's id. */
export const repick = (row: ScriptRow, line: StudioLine): ScriptRow => ({ ...recordedRow(line), id: row.id });

export function addRow(rows: readonly ScriptRow[], row: ScriptRow): ScriptRow[] {
  return rows.length >= MAX_SCRIPT_LINES ? [...rows] : [...rows, row];
}

export const removeRow = (rows: readonly ScriptRow[], id: number): ScriptRow[] => rows.filter((row) => row.id !== id);

/** Moves row `id` by `delta` places (clamped to the list). */
export function moveRow(rows: readonly ScriptRow[], id: number, delta: number): ScriptRow[] {
  const from = rows.findIndex((row) => row.id === id);
  const out = [...rows];
  if (from < 0) return out;
  const to = Math.min(out.length - 1, Math.max(0, from + delta));
  const [row] = out.splice(from, 1);
  if (row !== undefined) out.splice(to, 0, row);
  return out;
}

export const replaceRow = (rows: readonly ScriptRow[], next: ScriptRow): ScriptRow[] => rows.map((row) => (row.id === next.id ? next : row));

/** The rows as the design's line model (no ids). */
export const scriptOf = (rows: readonly ScriptRow[]): ScriptLine[] =>
  rows.map((row) => {
    const line: ScriptLine & { id?: number } = { ...row };
    delete line.id;
    return line;
  });

/** The next recorded line not yet in the script (the first one when all are used). */
export function nextRecorded(rows: readonly ScriptRow[], lines: readonly StudioLine[]): StudioLine | undefined {
  return lines.find((line) => !rows.some((row) => row.url === line.url)) ?? lines[0];
}

/** Every line has something to say. */
export const scriptReady = (rows: readonly ScriptRow[]): boolean => rows.length > 0 && rows.every((row) => (row.url ?? row.text.trim()).length > 0);
