// The ON AIR lightbox (voice-and-air requirement 4.2): lit while the show is on air, the brightest
// fill on the stage (air.test.tsx checks it against the role tokens). Beside it the VOICE tally,
// lit only while the character's voice is actually sounding (the loudness meter, useLoudness).
import styles from "./OnAirLamp.module.css";

export interface OnAirLampProps {
  lit: boolean;
  voiced: boolean;
}

export function OnAirLamp({ lit, voiced }: OnAirLampProps) {
  return (
    <div className={styles.lampRow}>
      <p className={styles.lamp} data-lit={lit ? "on" : "off"} role="status" aria-label={lit ? "On air" : "Off air"}>
        ON AIR
      </p>
      <p className={styles.tally} data-lit={voiced ? "on" : "off"} aria-hidden="true">
        <span className={styles.tallyDot} />
        VOICE
      </p>
    </div>
  );
}
