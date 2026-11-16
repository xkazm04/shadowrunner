// The Lines tab (spec flashhead-live, task 3.3): type a line, Speak sends a `say`; the history
// shows each line (typed and slide lines) with where it is and its measured timing.
import { useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { lineLengthMs, type LineRecord } from "./log";
import list from "./Log.module.css";
import styles from "./Live.module.css";

const STATUS_LABEL: Readonly<Record<LineRecord["status"], string>> = { sent: "queued", speaking: "speaking", done: "done", error: "not spoken" };

const ms = (value: number): string => `${Math.round(value)} ms`;

export function lineFigures(line: LineRecord): string {
  const parts: string[] = [];
  if (line.firstFrameMs !== undefined) parts.push(`first frame ${ms(line.firstFrameMs)}`);
  if (line.chunkMs !== undefined) parts.push(`chunk ${ms(line.chunkMs)}`);
  if (line.upscaleMs !== undefined && line.upscaleMs !== null) parts.push(`upscale ${ms(line.upscaleMs)}`);
  const length = lineLengthMs(line);
  if (length !== undefined) parts.push(`${(length / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

export interface LinesTabProps {
  lines: readonly LineRecord[];
  onSay: (text: string) => boolean;
  /** Why Speak is off (not connected, puppet mode), if it is. */
  blocked: string | undefined;
}

export function LinesTab({ lines, onSay, blocked }: LinesTabProps): ReactElement {
  const [text, setText] = useState("");
  const ready = blocked === undefined && text.trim() !== "";

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready && onSay(text.trim())) setText("");
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.tabBody}>
      <form className={styles.compose} onSubmit={submit}>
        <label className={styles.field}>
          <span>A line for Iris</span>
          <textarea
            className={styles.text}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="Good evening. The cellar is open."
            data-live="line-text"
          />
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={!ready} data-live="speak">
            Speak
          </button>
          <span className={styles.hint}>Enter speaks, Shift+Enter breaks the line.</span>
        </div>
        {blocked !== undefined && <p className={styles.hint}>{blocked}</p>}
      </form>
      {lines.length === 0 ? (
        <p className={styles.hint}>Lines you send show here with their timing.</p>
      ) : (
        <ol className={list.history} aria-label="Lines sent" data-live="lines">
          {lines.map((line) => (
            <li key={line.id} className={list.entry} data-line={line.id} data-state={line.status}>
              <span className={list.entryText}>{line.text}</span>
              <span className={list.entryMeta}>
                <span className={list.badge} data-state={line.status}>
                  {STATUS_LABEL[line.status]}
                </span>
                {line.origin === "slide" ? " slide · " : " "}
                {line.error ?? lineFigures(line)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
