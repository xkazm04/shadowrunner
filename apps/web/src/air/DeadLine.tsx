// The dead line (voice-and-air 5.1, costume 8.3): shown in the caption bar while /api/health fails
// or the engine has failed twice in a row. The corridor goes cold in CSS (`data-state="dead_line"`
// on the stage: candles to embers, tunnel light out, the bulb trying every 5 s); these are the
// words. Recovery is automatic.
import { HEALTH_POLL_MS } from "./stage";
import styles from "./Captions.module.css";

export const DEAD_LINE_TEXT = "LINE DEAD - reconnecting";

export function DeadLine() {
  return (
    <div className={styles.dead}>
      <p className={styles.deadLine} role="alert">
        {DEAD_LINE_TEXT}
      </p>
      <p className={styles.deadNote}>{`The candles are guttering. Trying the line again every ${HEALTH_POLL_MS / 1000} s.`}</p>
    </div>
  );
}
