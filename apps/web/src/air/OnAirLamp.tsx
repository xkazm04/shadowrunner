// The ON AIR lightbox (voice-and-air 4.2, costume 8.1): hung dead centre from the vault on two
// wires, swaying a little; it strikes like a neon tube when the show goes on air and is the
// brightest fill on the stage while lit (air.tokens.test.ts). The VOICE tally sits under the
// slate, lit only while the character's voice is actually sounding (useLoudness).
import styles from "./OnAirLamp.module.css";

export interface OnAirLampProps {
  lit: boolean;
}

export function OnAirLamp({ lit }: OnAirLampProps) {
  return (
    <div className={styles.hang}>
      <p className={styles.lamp} data-lit={lit ? "on" : "off"} role="status" aria-label={lit ? "On air" : "Off air"}>
        ON AIR
      </p>
    </div>
  );
}

export function VoiceTally({ voiced }: { voiced: boolean }) {
  return (
    <p className={styles.tally} data-lit={voiced ? "on" : "off"} aria-hidden="true">
      <span className={styles.tallyDot} />
      VOICE
    </p>
  );
}
