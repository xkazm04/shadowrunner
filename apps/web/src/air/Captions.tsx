// Captions (voice-and-air requirements 3.4, 4.6): the line being spoken, and the chat message it
// answers. Text roles on a dark plate: text-strong at the large size, at least 14 px equivalent
// and AA contrast. A line without audio says so, so a silent mouth reads as intended.
import type { Caption } from "./show";
import styles from "./air.module.css";

export interface CaptionsProps {
  caption?: Caption;
  speaker: string;
  /** Shown instead of a line (the dead line). */
  notice?: string;
}

export function Captions({ caption, speaker, notice }: CaptionsProps) {
  return (
    <div className={styles.captions} aria-live="polite" data-captions="">
      {notice !== undefined ? (
        <p className={styles.notice}>{notice}</p>
      ) : caption === undefined ? null : (
        <>
          {caption.answered && (
            <p className={styles.answering}>
              <span className={styles.answeringUser}>{caption.answered.user}</span> {caption.answered.text}
            </p>
          )}
          <p className={styles.line}>
            <span className={styles.speaker}>{speaker}</span> {caption.line}
          </p>
          {!caption.voiced && <p className={styles.captionOnly}>captions only</p>}
        </>
      )}
    </div>
  );
}
