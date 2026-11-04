// What the character says (requirement 4.2): on the live plane a text box (the /api/voice limit),
// on the replay plane the character's recorded lines (lines.ts), with a note when they are
// borrowed from another show in the same voice, and a sentence when there are none.
import type { ReactElement } from "react";
import type { Plane } from "../../app/plane";
import { MAX_LINE_CHARS, slugName, type ReplayLines } from "./lines";
import styles from "./Studio.module.css";

export interface LinePanelProps {
  plane: Plane;
  name: string;
  text: string;
  onText(text: string): void;
  replay: ReplayLines;
  /** Index into `replay.lines`. */
  picked: number;
  onPick(index: number): void;
  busy: boolean;
}

export function LinePanel({ plane, name, text, onText, replay, picked, onPick, busy }: LinePanelProps): ReactElement {
  if (plane === "live") {
    return (
      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>Line</legend>
        <label className={styles.field}>
          <span>What {name} says</span>
          <textarea className={styles.text} value={text} maxLength={MAX_LINE_CHARS} rows={3} onChange={(e) => onText(e.target.value)} />
        </label>
        <p className={styles.hint}>
          {text.length} / {MAX_LINE_CHARS}
        </p>
      </fieldset>
    );
  }
  return (
    <fieldset className={styles.group} disabled={busy}>
      <legend className={styles.legend}>Recorded line</legend>
      {replay.lines.length === 0 ? (
        <p className={styles.hint} data-studio="no-lines">
          {name} has no recorded lines yet. On the replay plane the studio plays only recorded lines; the live plane speaks anything you type.
        </p>
      ) : (
        <>
          {replay.borrowedFrom === undefined ? null : (
            <p className={styles.hint} data-studio="borrowed">
              {name} has no recordings of their own: these are {slugName(replay.borrowedFrom)}&apos;s lines, recorded in the same voice.
            </p>
          )}
          <ul className={styles.lines} aria-label="Recorded lines">
            {replay.lines.map((line, i) => (
              <li key={line.url}>
                <label className={styles.line}>
                  <input type="radio" name="studio-line" checked={i === picked} onChange={() => onPick(i)} />
                  <span>{line.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
