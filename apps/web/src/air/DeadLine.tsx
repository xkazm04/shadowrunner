// The dead line (voice-and-air requirement 5.1): shown in the captions' place while /api/health
// fails or the engine has failed twice in a row. The bulb, the lamp and the face go dark in CSS
// (`data-state="dead_line"` on the stage); this is the words. Recovery is automatic.
import { HEALTH_POLL_MS } from "./stage";
import styles from "./Captions.module.css";

export const DEAD_LINE_TEXT = "LINE DEAD - reconnecting";

export function DeadLine() {
  return (
    <div className={styles.captions} data-captions="" data-dead-line="">
      <p className={styles.deadLine} role="alert">
        {DEAD_LINE_TEXT}
      </p>
      <p className={styles.captionOnly}>{`Nothing answers on the line. Trying again every ${HEALTH_POLL_MS / 1000} s.`}</p>
    </div>
  );
}
