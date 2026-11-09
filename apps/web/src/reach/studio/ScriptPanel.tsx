// The script (perfection-pass task 6, requirement 6.1-6.2; it replaces the single-line panel of
// spec avatar-reach 4.2): an ordered list of lines, each a typed line (live plane) or a recorded
// one (replay plane), with a mood and a gesture, and the pause between lines.
//
// Decisions:
// - Moods and gestures are the engine's lists, in the creator's mood-dial order and with its
//   labels (the dial shows the emotion's name, gestures read "lean in"). The mood "look's own"
//   leaves `emotion` out.
// - Reorder and remove are buttons with names ("Move line 2 up"); after a move the same button of
//   the moved line keeps the focus (or its partner when it is now disabled at the end of the list),
//   so the keyboard can keep moving a line.
// - The limits are stated in the panel, not only enforced.
import { EMOTIONS, GESTURES } from "@sr/engine";
import type { Emotion } from "@sr/rig";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Plane } from "../../app/plane";
import { gestureLabel } from "../../creator/glass/gestures";
import { MAX_LINE_CHARS, slugName, type ReplayLines } from "./lines";
import { addRow, MAX_PAUSE_MS, MAX_SCRIPT_LINES, MAX_TAKE_S, moveRow, nextRecorded, recordedRow, removeRow, replaceRow, repick, typedRow, withField, type ScriptRow } from "./script";
import styles from "./Studio.module.css";

export interface ScriptPanelProps {
  plane: Plane;
  name: string;
  /** The look's own mood (the "look's own" option says which). */
  lookEmotion: Emotion;
  replay: ReplayLines;
  rows: readonly ScriptRow[];
  onRows(rows: ScriptRow[]): void;
  pauseMs: number;
  onPause(ms: number): void;
  busy: boolean;
}

type Act = "up" | "down";

const short = (text: string): string => (text.length > 70 ? `${text.slice(0, 67)}…` : text);

export function ScriptPanel({ plane, name, lookEmotion, replay, rows, onRows, pauseMs, onPause, busy }: ScriptPanelProps): ReactElement {
  const list = useRef<HTMLOListElement>(null);
  const [focus, setFocus] = useState<{ id: number; act: Act } | undefined>(undefined);

  useEffect(() => {
    if (focus === undefined) return;
    const row = list.current?.querySelector(`[data-row="${focus.id}"]`);
    const want = row?.querySelector<HTMLButtonElement>(`[data-act="${focus.act}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-act="${focus.act === "up" ? "down" : "up"}"]`);
    (want?.disabled === false ? want : other)?.focus();
    setFocus(undefined);
  }, [focus]);

  const move = (row: ScriptRow, act: Act): void => {
    onRows(moveRow(rows, row.id, act === "up" ? -1 : 1));
    setFocus({ id: row.id, act });
  };

  if (plane === "replay" && replay.lines.length === 0) {
    return (
      <fieldset className={styles.group} disabled={busy}>
        <legend className={styles.legend}>Script</legend>
        <p className={styles.hint} data-studio="no-lines">
          {name} has no recorded lines yet. On the replay plane the studio plays only recorded lines; the live plane speaks anything you type.
        </p>
      </fieldset>
    );
  }

  const add = (): void => {
    const next = plane === "live" ? typedRow() : nextRecorded(rows, replay.lines);
    if (next !== undefined) onRows(addRow(rows, "id" in next ? next : recordedRow(next)));
  };

  return (
    <fieldset className={styles.group} disabled={busy}>
      <legend className={styles.legend}>Script</legend>
      {replay.borrowedFrom === undefined || plane === "live" ? null : (
        <p className={styles.hint} data-studio="borrowed">
          {name} has no recordings of their own: these are {slugName(replay.borrowedFrom)}&apos;s lines, recorded in the same voice.
        </p>
      )}
      <p className={styles.hint}>
        Up to {MAX_SCRIPT_LINES} lines and {MAX_TAKE_S} s a take, recorded as one video. Each line plays in its mood; a gesture fires as the line starts.
      </p>
      <ol ref={list} className={styles.script} aria-label="Script">
        {rows.map((row, i) => {
          const n = i + 1;
          return (
            <li key={row.id} data-row={row.id} className={styles.row}>
              <span className={styles.rowNumber} aria-hidden="true">
                {n}
              </span>
              {plane === "live" ? (
                <label className={styles.field}>
                  <span>
                    Line {n} ({row.text.length} / {MAX_LINE_CHARS})
                  </span>
                  <textarea
                    className={styles.text}
                    value={row.text}
                    maxLength={MAX_LINE_CHARS}
                    rows={2}
                    onChange={(e) => onRows(replaceRow(rows, { ...row, text: e.target.value }))}
                  />
                </label>
              ) : (
                <label className={styles.field}>
                  <span>Line {n}</span>
                  <select
                    value={row.url ?? ""}
                    data-script="clip"
                    onChange={(e) => {
                      const line = replay.lines.find((l) => l.url === e.target.value);
                      if (line !== undefined) onRows(replaceRow(rows, repick(row, line)));
                    }}
                  >
                    {replay.lines.map((line) => (
                      <option key={line.url} value={line.url}>
                        {short(line.text)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.rowControls}>
                <label className={styles.field}>
                  <span>Mood</span>
                  <select
                    value={row.emotion ?? ""}
                    aria-label={`Line ${n} mood`}
                    onChange={(e) => onRows(replaceRow(rows, withField(row, "emotion", EMOTIONS.find((m) => m === e.target.value))))}
                  >
                    <option value="">look&apos;s own ({lookEmotion})</option>
                    {EMOTIONS.map((emotion) => (
                      <option key={emotion} value={emotion}>
                        {emotion}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Gesture</span>
                  <select
                    value={row.gesture ?? ""}
                    aria-label={`Line ${n} gesture`}
                    onChange={(e) => onRows(replaceRow(rows, withField(row, "gesture", GESTURES.find((g) => g === e.target.value))))}
                  >
                    <option value="">none</option>
                    {GESTURES.map((gesture) => (
                      <option key={gesture} value={gesture}>
                        {gestureLabel(gesture)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.rowButtons}>
                  <button type="button" className={styles.small} data-act="up" aria-label={`Move line ${n} up`} disabled={i === 0} onClick={() => move(row, "up")}>
                    ↑
                  </button>
                  <button type="button" className={styles.small} data-act="down" aria-label={`Move line ${n} down`} disabled={i === rows.length - 1} onClick={() => move(row, "down")}>
                    ↓
                  </button>
                  <button type="button" className={styles.small} aria-label={`Remove line ${n}`} disabled={rows.length <= 1} onClick={() => onRows(removeRow(rows, row.id))}>
                    ✕
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className={styles.actions}>
        <button type="button" className={styles.small} disabled={rows.length >= MAX_SCRIPT_LINES} onClick={add} data-script="add">
          Add line
        </button>
        <span className={styles.hint}>
          {rows.length} / {MAX_SCRIPT_LINES} lines
        </span>
      </div>
      <label className={styles.field}>
        <span>
          Pause between lines: <output>{pauseMs} ms</output>
        </span>
        <input type="range" min={0} max={MAX_PAUSE_MS} step={50} value={pauseMs} onChange={(e) => onPause(Number(e.target.value))} data-script="pause" />
      </label>
    </fieldset>
  );
}
